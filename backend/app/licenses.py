"""Dependency license inventory. Unknown licenses require documented release review."""

import argparse
import importlib.metadata
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    records = []
    for distribution in importlib.metadata.distributions():
        info = distribution.metadata
        license = (
            info.get("License-Expression")
            or info.get("License")
            or "; ".join(
                value.removeprefix("License :: ")
                for value in info.get_all("Classifier", [])
                if value.startswith("License :: ")
            )
            or "UNKNOWN"
        )
        records.append(
            {
                "name": info["Name"],
                "version": distribution.version,
                "license": license,
                "home": info.get("Home-page") or info.get("Project-URL", ""),
            }
        )
    args.output.write_text(
        json.dumps(sorted(records, key=lambda row: row["name"].lower()), ensure_ascii=False, indent=2) + "\n"
    )
    print(
        f"Inventoried {len(records)} installed distributions; review unknown and reciprocal licenses before release"
    )


if __name__ == "__main__":
    main()
