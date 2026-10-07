"""Opt-in synthetic 100k import and 100-user concurrency benchmark, in an isolated DB."""

import io
import json
import os
import platform
import resource
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import insert

from app.core.security import digest, now, token
from app.models import AuthSession, Member, Profile, Snapshot, User
from tests.test_v1_postgres import context as context
from tests.test_v1_postgres import mutate

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_PERFORMANCE") != "1", reason="Explicit synthetic load stand"
)


def percentile(values, p):
    return sorted(values)[min(len(values) - 1, int(len(values) * p))]


def test_large_import_and_concurrent_reads(context):
    client, factory, uid, pid = context
    content = io.BytesIO()
    with zipfile.ZipFile(content, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "followers_1.json",
            json.dumps([{"string_list_data": [{"value": f"follower_{i:06d}"}]} for i in range(50000)]),
        )
        archive.writestr(
            "following.json",
            json.dumps(
                {
                    "relationships_following": [
                        {"string_list_data": [{"value": f"follower_{i:06d}"}]} for i in range(25000, 75000)
                    ]
                }
            ),
        )
    started = time.perf_counter()
    uploaded = mutate(
        client,
        "POST",
        f"/profiles/{pid}/imports",
        files=[("file", ("large.zip", content.getvalue(), "application/zip"))],
    )
    assert uploaded.status_code == 202, uploaded.text
    from app.jobs.tasks import process

    jid = uploaded.json()["id"]
    process.run(jid)
    confirmation = mutate(
        client,
        "POST",
        f"/imports/{jid}/confirm",
        json={
            "observed_at": now().isoformat(),
            "full_period": True,
            "followers_complete": True,
            "following_complete": True,
            "owns_data": True,
        },
    )
    assert confirmation.status_code == 202, confirmation.text
    process.run(jid)
    status = client.get("/api/v1/imports/" + jid).json()
    assert status["status"] == "completed", status
    import_seconds = time.perf_counter() - started
    accounts = []
    with factory() as db:
        main_cookie = client.cookies.get("insta_session")
        accounts.append((pid, main_cookie))
        timestamp = now()
        users = [
            {
                "id": str(uuid4()),
                "created_at": timestamp,
                "email": f"load_{i}@example.com",
                "password_hash": "unusable",
                "verified": True,
                "status": "active",
            }
            for i in range(999)
        ]
        db.execute(insert(User), users)
        counts = {
            "followers": 10,
            "following": 0,
            "mutual": 0,
            "fans": 10,
            "not_following_back": 0,
            "mutual_rate": 0.0,
        }
        for user in users[:99]:
            profile = Profile(user_id=user["id"], username="load_" + user["id"][:8])
            db.add(profile)
            db.flush()
            snap = Snapshot(
                profile_id=profile.id,
                source="archive",
                identity_mode="username",
                completeness="user_confirmed",
                checksum="synthetic",
                observed_at=timestamp,
                counts=counts,
                provenance={},
                storage_bytes=1000,
            )
            db.add(snap)
            db.flush()
            db.execute(
                insert(Member),
                [
                    {
                        "id": str(uuid4()),
                        "created_at": timestamp,
                        "snapshot_id": snap.id,
                        "relation": "followers",
                        "identity_key": f"person_{j}",
                        "username": f"person_{j}",
                    }
                    for j in range(10)
                ],
            )
            raw = token()
            db.add(
                AuthSession(
                    user_id=user["id"],
                    token_hash=digest(raw),
                    expires_at=timestamp + timedelta(hours=1),
                    last_seen=timestamp,
                )
            )
            accounts.append((profile.id, raw))
        db.commit()

    # 100 distinct sessions. Five request rounds; private cookies are never written to the report.
    def request(index):
        profile, cookie = accounts[index % 100]
        path = f"/api/v1/profiles/{profile}/" + (
            "summary" if index % 2 else "people?category=followers&limit=50"
        )
        before = time.perf_counter()
        response = client.get(path, headers={"Cookie": "insta_session=" + cookie})
        elapsed = time.perf_counter() - before
        return elapsed, response.status_code, "summary" if index % 2 else "people"

    for i in range(100):
        request(i)
    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=100) as pool:
        results = list(pool.map(request, range(500)))
    elapsed = time.perf_counter() - start
    timings = [x[0] for x in results]
    report = {
        "stand": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "api_transport": "ASGI TestClient; no TLS/proxy/network latency",
            "database_io": "SQLAlchemy AsyncSession + psycopg.AsyncConnection (HTTP); sync Celery",
            "test_db_pool": {"size": 20, "max_overflow": 30},
            "registered_users": 1000,
            "concurrent_distinct_users": 100,
            "member_rows_largest_snapshot": 100000,
            "small_profiles": 99,
            "request_count": 500,
            "notes": "Local Docker stand; repeat on agreed 4 vCPU / 8 GB deployment for production acceptance.",
        },
        "import": {"records": 100000, "seconds": round(import_seconds, 3)},
        "reads": {
            "seconds": round(elapsed, 3),
            "p50_seconds": round(percentile(timings, 0.50), 3),
            "p95_seconds": round(percentile(timings, 0.95), 3),
            "errors": sum(status != 200 for _, status, _ in results),
        },
        "process_peak_rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    }
    for kind in ("summary", "people"):
        values = [t for t, _, k in results if k == kind]
        report["reads"][kind + "_p95_seconds"] = round(percentile(values, 0.95), 3)
    output = Path(os.environ.get("PERF_REPORT_PATH", "/tmp/insta-performance.json"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    assert report["reads"]["errors"] == 0, report
    assert import_seconds < 120, report
    assert percentile(timings, 0.95) < 1, report
