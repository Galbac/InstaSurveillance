class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, details: dict | None = None):
        self.code, self.message, self.status, self.details = code, message, status, details or {}
        super().__init__(code)


def required[T](value: T | None, code: str = "cancelled") -> T:
    if value is None:
        raise AppError(code, "Объект больше недоступен", 409 if code == "cancelled" else 404)
    return value
