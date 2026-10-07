"""Read-only public HTTP acceptance probe; no accounts, emails or Instagram requests.

HTTPS certificates are verified by Python's standard trust store. Local HTTP
requires --allow-http and is explicitly excluded from TLS acceptance.
"""

import argparse
import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Public origin, e.g. https://insta.example.org")
    parser.add_argument("--report", required=True)
    parser.add_argument("--allow-http", action="store_true", help="Local checks only; no TLS acceptance")
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.url)
    if (
        url.scheme not in ("https", "http")
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path not in ("", "/")
        or (url.scheme != "https" and not args.allow_http)
    ):
        parser.error("Use an HTTPS origin without credentials/path/query, or explicitly allow local HTTP")
    origin = args.url.rstrip("/")
    opener = urllib.request.build_opener(
        NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context())
    )
    checks = []

    def fetch(path, expected, validate=None, private=False):
        started = time.monotonic()
        entry = {"path": path, "expected_status": expected, "passed": False}
        try:
            request = urllib.request.Request(
                origin + path, headers={"User-Agent": "InstaSurveillance-Acceptance/1", "Accept": "*/*"}
            )
            try:
                response = opener.open(request, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = response.read(2 * 1024 * 1024 + 1)
                status = response.code
                entry["status"] = status
                if len(body) > 2 * 1024 * 1024:
                    raise ValueError("oversized_response")
                assert status in expected, "unexpected_status"
                assert response.headers.get("X-Content-Type-Options") == "nosniff", "missing_nosniff"
                assert response.headers.get("Referrer-Policy") == "no-referrer", "missing_referrer_policy"
                if url.scheme == "https":
                    assert "max-age=" in response.headers.get("Strict-Transport-Security", ""), "missing_hsts"
                if private:
                    assert "no-store" in response.headers.get("Cache-Control", ""), "private_cache_enabled"
                if validate:
                    validate(body, response.headers)
                entry["passed"] = True
        except Exception as error:
            # URLs, raw bodies, certificate subjects and upstream errors are not logged.
            entry["error_type"] = type(error).__name__
            if isinstance(error, AssertionError):
                entry["check"] = str(error)
        entry["seconds"] = round(time.monotonic() - started, 3)
        checks.append(entry)

    def json_status(expected):
        def validate(body, headers):
            assert json.loads(body)["status"] == expected, "incorrect_health_status"

        return validate

    def manifest(body, headers):
        data = json.loads(body)
        assert data["display"] == "standalone", "incorrect_pwa_display"
        assert data["start_url"] == "/app", "incorrect_pwa_start"
        assert {"192x192", "512x512"}.issubset({icon["sizes"] for icon in data["icons"]}), "missing_pwa_icons"

    def image(body, headers):
        assert body.startswith(b"\x89PNG\r\n\x1a\n"), "invalid_png"

    def worker(body, headers):
        assert "javascript" in headers.get("Content-Type", ""), "incorrect_worker_mime"
        assert b"SKIP_WAITING" in body, "missing_explicit_update_handler"

    fetch("/", [200])
    fetch("/api/v1/health/live", [200], json_status("ok"), private=True)
    fetch("/api/v1/health/ready", [200], json_status("ready"), private=True)
    fetch("/api/v1/profiles", [401], private=True)
    fetch("/api/v1/metrics", [404], private=True)
    fetch("/manifest.webmanifest", [200], manifest)
    fetch("/sw.js", [200], worker)
    fetch("/offline.html", [200])
    fetch("/icon-192.png", [200], image)
    fetch("/icon-512.png", [200], image)
    report = {
        "checked_at": datetime.now(UTC).isoformat(),
        "origin": origin,
        "tls_verified": url.scheme == "https" and all(c["passed"] for c in checks),
        "passed": all(c["passed"] for c in checks),
        "checks": checks,
        "scope": "Read-only HTTP: health, security headers, auth boundary and PWA assets",
        "not_checked": [
            "browser/device layout",
            "PWA installation/offline/update UX",
            "SMTP delivery",
            "S3 permissions/lifecycle",
            "Instagram",
            "cloud load/RPO/RTO",
            "alert delivery",
        ],
    }
    output = Path(args.report)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(
        f"Public HTTP probe: {sum(c['passed'] for c in checks)}/{len(checks)} passed; TLS {'enabled' if url.scheme == 'https' else 'not tested'}"
    )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
