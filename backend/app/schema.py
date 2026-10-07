"""Deterministic OpenAPI generation without starting the HTTP service."""

import argparse
import json
from pathlib import Path

from app.main import app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
