class ApiError(Exception):
    """Raise anywhere; the Flask error handler turns it into JSON."""

    def __init__(self, code: str, message: str, http: int = 400, **extra):
        super().__init__(message)
        self.code, self.message, self.http, self.extra = code, message, http, extra

    def to_json(self):
        return {"error": {"code": self.code, "message": self.message, **self.extra}}
