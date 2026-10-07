"""Bounded sequential archive reader. Never extracts files or follows archive URLs."""

import io
import json
import re
import stat
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import PurePosixPath

from app.core.errors import AppError
from app.core.streams import SeekableReader
from app.domain.analytics import Relationships

USERNAME = re.compile(r"[a-z0-9._]{1,30}\Z")
ALLOWLIST = re.compile(r"followers(?:_\d+)?\.json|following\.json")
MAX_ENTRY_BYTES = 64 * 1024 * 1024


def normalize_username(value: str) -> str:
    name = value.strip().removeprefix("@").lower()
    if not USERNAME.fullmatch(name):
        raise AppError("invalid_username", "Некорректный Instagram username")
    return name


def validate_json_depth(raw: bytes, max_depth: int = 32) -> None:
    depth, quoted, escaped = 0, False, False
    for char in raw:
        if quoted:
            if escaped:
                escaped = False
            elif char == 92:
                escaped = True
            elif char == 34:
                quoted = False
        elif char == 34:
            quoted = True
        elif char in (123, 91):
            depth += 1
            if depth > max_depth:
                raise AppError("json_depth_limit", "Слишком сложная структура JSON")
        elif char in (125, 93):
            depth -= 1


def archive_entries(
    stream: SeekableReader, filename: str, max_unpacked: int, max_entries: int, report: dict | None = None
) -> Iterator[tuple[str, bytes]]:
    signature = stream.read(4)
    stream.seek(0)
    if signature.startswith(b"PK"):
        try:
            with zipfile.ZipFile(stream) as archive:
                entries = archive.infolist()
                if len(entries) > max_entries:
                    raise AppError("archive_limit", "Слишком много файлов в архиве")
                total, names, parents, accepted = 0, set(), set(), []
                for entry in entries:
                    path = PurePosixPath(entry.filename)
                    if (
                        path.is_absolute()
                        or ".." in path.parts
                        or "\\" in entry.filename
                        or stat.S_ISLNK(entry.external_attr >> 16)
                    ):
                        raise AppError("unsafe_archive", "Небезопасная структура архива")
                    if path.suffix.lower() in (".zip", ".7z", ".rar", ".gz"):
                        raise AppError("nested_archive", "Вложенные архивы не поддерживаются")
                    total += entry.file_size
                    if total > max_unpacked or entry.flag_bits & 1:
                        raise AppError("archive_limit", "Архив слишком большой или защищён паролем")
                    if ALLOWLIST.fullmatch(path.name):
                        if path.name in names:
                            raise AppError("mixed_archives", "В архиве несколько наборов подписок")
                        names.add(path.name)
                        parents.add(str(path.parent))
                        accepted.append(entry)
                if len(parents) > 1 or (
                    "followers.json" in names and any(n.startswith("followers_") for n in names)
                ):
                    raise AppError("mixed_archives", "Загрузите один набор данных одного профиля")
                numbered = sorted(
                    int(n.removeprefix("followers_").removesuffix(".json"))
                    for n in names
                    if n.startswith("followers_")
                )
                if numbered and numbered != list(range(1, numbered[-1] + 1)):
                    raise AppError("partial_archive", "Найдена только часть файлов подписчиков")
                if not accepted and any(x.filename.lower().endswith(".html") for x in entries):
                    raise AppError("html_export", "Это HTML-экспорт. Выберите формат JSON")
                if report is not None:
                    report.update(
                        accepted_files=[PurePosixPath(e.filename).name for e in accepted],
                        ignored_files=[
                            PurePosixPath(e.filename).name
                            for e in entries
                            if e not in accepted and not e.is_dir()
                        ],
                        entry_count=len(entries),
                        declared_unpacked_bytes=total,
                    )
                for entry in accepted:
                    with archive.open(entry) as reader:
                        raw = reader.read(min(MAX_ENTRY_BYTES, max_unpacked) + 1)
                    if len(raw) > min(MAX_ENTRY_BYTES, max_unpacked):
                        raise AppError(
                            "archive_limit", "JSON-файл слишком большой; выберите экспорт только связей"
                        )
                    yield PurePosixPath(entry.filename).name, raw
        except (zipfile.BadZipFile, RuntimeError) as error:
            raise AppError("invalid_archive", "Не удалось прочитать ZIP") from error
    elif filename.lower().endswith(".json") and ALLOWLIST.fullmatch(PurePosixPath(filename).name):
        raw = stream.read(min(MAX_ENTRY_BYTES, max_unpacked) + 1)
        if len(raw) > min(MAX_ENTRY_BYTES, max_unpacked):
            raise AppError("archive_limit", "JSON-файл слишком большой")
        yield PurePosixPath(filename).name, raw
    else:
        raise AppError("unsupported_format", "Выберите ZIP или совместимые JSON-файлы Instagram")


def parse_archive(
    data: bytes | SeekableReader,
    filename: str,
    max_unpacked: int,
    max_entries: int,
    max_members: int,
    report: dict | None = None,
) -> Relationships:
    stream = io.BytesIO(data) if isinstance(data, bytes) else data
    followers, following, seen, timestamps = {}, {}, set(), {}
    for name, raw in archive_entries(stream, filename, max_unpacked, max_entries, report):
        relation = "following" if name == "following.json" else "followers"
        seen.add(relation)
        validate_json_depth(raw)
        try:
            obj = json.loads(raw)
            records = (
                obj.get("relationships_following")
                if relation == "following" and isinstance(obj, dict)
                else obj
            )
            if not isinstance(records, list):
                raise ValueError("Unknown structure")
            for record in records:
                if not isinstance(record, dict) or len(record.get("string_list_data", [])) > 10:
                    raise ValueError("Invalid record")
                for item in record["string_list_data"]:
                    if not isinstance(item["value"], str) or len(item["value"]) > 128:
                        raise ValueError("Invalid username")
                    username = normalize_username(item["value"])
                    (following if relation == "following" else followers)[username] = (
                        item["value"].strip().removeprefix("@")
                    )
                    if isinstance(item.get("timestamp"), (int, float)) and not isinstance(
                        item["timestamp"], bool
                    ):
                        timestamps[relation + ":" + username] = datetime.fromtimestamp(item["timestamp"], UTC)
                    if len(followers) + len(following) > max_members:
                        raise AppError("members_limit", "Слишком много записей")
        except (
            ValueError,
            OverflowError,
            OSError,
            KeyError,
            TypeError,
            RecursionError,
            UnicodeDecodeError,
        ) as error:
            raise AppError("unsupported_format", "Структура JSON-экспорта не поддерживается") from error
    if seen != {"followers", "following"}:
        raise AppError("missing_category", "Не найдены полные файлы подписчиков и подписок")
    return Relationships(followers, following, timestamps)
