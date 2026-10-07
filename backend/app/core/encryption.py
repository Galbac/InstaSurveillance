"""Versioned AEAD envelope; previous keys are accepted only for decryption."""

from cryptography.fernet import Fernet, InvalidToken, MultiFernet


class VersionedCipher:
    def __init__(self, version: str, current: str, previous: dict[str, str]):
        self.version = version
        self.keys = {key: Fernet(value.encode()) for key, value in previous.items()}
        self.keys[version] = Fernet(current.encode())
        self.legacy = MultiFernet(
            [self.keys[version]] + [value for key, value in self.keys.items() if key != version]
        )

    def encrypt(self, data: bytes) -> bytes:
        return b"v" + self.version.encode() + b":" + self.keys[self.version].encrypt(data)

    def decrypt(self, data: bytes) -> bytes:
        if not data.startswith(b"v"):
            return self.legacy.decrypt(data)
        header, separator, payload = data.partition(b":")
        if not separator:
            raise InvalidToken
        try:
            key = self.keys[header[1:].decode()]
        except UnicodeDecodeError, KeyError:
            raise InvalidToken from None
        return key.decrypt(payload)
