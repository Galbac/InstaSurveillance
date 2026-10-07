#!/bin/sh
set -eu
scan_tag=${1:-local}
case "$scan_tag" in ''|*[!A-Za-z0-9_.-]*) exit 2;; esac
scan_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
mkdir -p "$scan_root/docs/reports"
docker volume create insta-trivy-cache >/dev/null
for scan_service in backend frontend backup; do
  # auditwheel SBOM describes wheel construction tools, which are absent at runtime.
  # Native-library SBOMs are kept; no vulnerability ID or severity is suppressed.
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock:ro -v insta-trivy-cache:/root/.cache -v "$scan_root/docs/reports:/reports" aquasec/trivy:0.75.0 image --image-src docker --scanners vuln --no-progress --skip-files '**/auditwheel.cdx.json' --format json --output "/reports/$scan_service-image-audit.json" "instasurveillance-$scan_service:$scan_tag"
done
python3 "$scan_root/deploy/scripts/check-image-audits.py"
