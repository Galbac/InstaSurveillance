#!/bin/sh
# Run on the prepared host. The environment file is private and outside the checkout.
set -eu
if [ "$#" -ne 2 ]; then
  echo 'Usage: deploy.sh /absolute/private/.env.prod release-tag' >&2
  exit 2
fi
release_env=$1
release_tag=$2
case "$release_env" in /*) ;; *) echo 'Use an absolute environment path' >&2; exit 2;; esac
case "$release_tag" in ''|*[!A-Za-z0-9_.-]*) echo 'Invalid release tag' >&2; exit 2;; esac
[ -f "$release_env" ] || exit 2
release_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$release_root"
python3 - "$release_env" "$release_root" <<'PY'
import pathlib, stat, sys
p=pathlib.Path(sys.argv[1]).resolve()
if p.is_relative_to(pathlib.Path(sys.argv[2]).resolve()):
    raise SystemExit('Keep production secrets outside the checkout')
if stat.S_IMODE(p.stat().st_mode) & 0o077:
    raise SystemExit('Environment file must be readable by its owner only (0600)')
PY
export RELEASE_TAG="$release_tag"
compose() { docker compose --env-file "$release_env" -f compose.prod.yml "$@"; }
compose config --quiet
compose build backend frontend backup
./deploy/scripts/scan-images.sh "$release_tag"
# Validate environment before stopping an existing release. Do not print config or secrets.
compose run --rm --no-deps backend python -c 'from app.core.config import get_settings; get_settings(); print("Production settings valid")'
compose up -d db redis auth-vault
# Existing API stays stopped if any following step fails. Operator investigates and rolls back.
compose stop backend frontend worker auth-worker maintenance scheduler backup
# A nonempty pre-migration copy is uploaded to the independent backup bucket.
compose run --rm --no-deps backup python -m app.backups create
compose run --rm migrate
compose up -d --wait --wait-timeout 180
compose exec -T backend python - <<'PY'
import urllib.request
for path in ('/api/v1/health/live','/api/v1/health/ready'):
    with urllib.request.urlopen('http://127.0.0.1:8000'+path,timeout=15) as response:
        assert response.status == 200
print('Internal liveness and readiness passed')
PY
printf 'Release %s started. Verify public HTTPS and operator access using OPERATIONS.md.\n' "$release_tag"
