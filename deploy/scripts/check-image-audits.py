"""No blanket ignores: unresolved HIGH/CRITICAL findings block a public release."""
import json
from collections import Counter
from pathlib import Path

root=Path(__file__).resolve().parents[2]/'docs/reports'
failed=False
for service in ('backend','frontend','backup'):
    report=json.loads((root/f'{service}-image-audit.json').read_text())
    counts=Counter(v['Severity'] for result in report.get('Results',[]) for v in result.get('Vulnerabilities',[]))
    print(service, dict(counts))
    failed=failed or bool(counts['HIGH'] or counts['CRITICAL'])
if failed:
    raise SystemExit('Release blocked: triage or fix HIGH/CRITICAL image findings; reports preserved')
print('Image advisory gate passed')
