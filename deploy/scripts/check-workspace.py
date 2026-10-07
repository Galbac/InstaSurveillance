"""Repository cache check; Docker named volumes and /tmp are outside this tree."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
forbidden={'.next','node_modules','__pycache__','.pytest_cache','.ruff_cache','.mypy_cache','.venv','.cache'}
found=[str(path.relative_to(root)) for path in root.rglob('*') if path.name in forbidden or path.suffix in ('.pyc','.pyo','.tsbuildinfo')]
if found:raise SystemExit('Unexpected repository caches: '+', '.join(found[:30]))
print('No repository cache or dependency directories')
