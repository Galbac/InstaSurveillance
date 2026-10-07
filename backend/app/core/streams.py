from typing import Protocol


class BinaryReader(Protocol):
    def read(self, size: int = -1, /) -> bytes: ...


class BinaryWriter(Protocol):
    def write(self, data: bytes, /) -> int | None: ...


class SeekableReader(BinaryReader, Protocol):
    def seek(self, offset: int, whence: int = 0, /) -> int: ...
