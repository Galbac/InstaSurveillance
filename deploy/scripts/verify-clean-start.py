"""Boot an isolated clean source copy with new credentials and empty Docker volumes.

Only synthetic accounts are used. No real Instagram requests or external deployment.
Docker credentials and build caches remain outside the source tree.
"""
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket() as connection:
        connection.bind(("127.0.0.1", 0))
        return connection.getsockname()[1]


def main() -> None:
    project = "insta-clean-" + secrets.token_hex(5)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="insta-clean-") as temporary:
        copy = Path(temporary) / "source"
        shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns(
            ".git", ".env.dev", ".env.prod", "node_modules", ".next", "__pycache__",
            "*.pyc", "*.tsbuildinfo", ".venv", ".cache", ".pytest_cache", ".ruff_cache",
        ))
        environment = os.environ.copy()
        # This generator creates a new 0600 file; existing workspace credentials are never copied.
        subprocess.run([sys.executable, "deploy/scripts/setup-env.py"], cwd=copy, check=True,
                       stdout=subprocess.DEVNULL)
        web, api, mail = free_port(), free_port(), free_port()
        if len({web, api, mail}) != 3:
            raise RuntimeError("Port allocation collision; retry the drill")
        path = copy / ".env.dev"
        values = {"APP_BASE_URL": f"http://localhost:{web}", "DEV_WEB_PORT": str(web),
                  "DEV_API_PORT": str(api), "DEV_MAIL_PORT": str(mail)}
        path.write_text("\n".join(
            key + "=" + values.get(key, value) if separator else line
            for line in path.read_text().splitlines()
            for key, separator, value in [line.partition("=")]
        ) + "\n")
        environment.update(SMOKE_BASE_URL=f"http://localhost:{web}", SMOKE_MAIL_URL=f"http://localhost:{mail}")
        compose = ([os.environ["COMPOSE_BINARY"]] if os.environ.get("COMPOSE_BINARY") else ["docker", "compose"])
        compose += ["-p", project, "--env-file", str(path), "-f", str(copy / "compose.dev.yml")]
        # Logs stay private outside the checkout; errors never print secret-bearing container output.
        log_path = Path(temporary) / "drill.log"
        descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as log:
            try:
                subprocess.run(compose + ["up", "--build", "-d"], cwd=copy, env=environment,
                               stdout=log, stderr=log, check=True, timeout=600)
                deadline = time.monotonic() + 180
                while time.monotonic() < deadline:
                    try:
                        with urllib.request.urlopen(environment["SMOKE_BASE_URL"] + "/api/v1/health/ready", timeout=5) as response:
                            if response.status == 200:
                                break
                    except (OSError, TimeoutError):
                        pass
                    time.sleep(1)
                else:
                    raise RuntimeError("Clean stack readiness timed out")
                subprocess.run([sys.executable, "deploy/scripts/verify-dev-stack.py"], cwd=copy, env=environment,
                               stdout=log, stderr=log, check=True, timeout=300)
                workflow = json.loads((copy / "docs/reports/dev-stack-smoke.json").read_text())
                report = {"stand": "clean source copy; new 0600 env; empty isolated Docker volumes",
                          "source_is_git_checkout": False, "storage_backend": "s3", "local_s3_provider": "Garage v2.4.1", "full_http_workflow": workflow,
                          "seconds": round(time.monotonic() - started, 3), "cloud_acceptance": False}
            finally:
                # The randomly named project is owned by this drill; existing dev volumes are untouched.
                subprocess.run(compose + ["down", "-v", "--remove-orphans"], cwd=copy, env=environment,
                               stdout=log, stderr=log, check=True, timeout=90)
        (ROOT / "docs/reports/clean-start.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Clean start and synthetic workflow passed; isolated containers and volumes removed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Clean start failed: " + type(error).__name__, file=sys.stderr)
        raise SystemExit(1) from None
