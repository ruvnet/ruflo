from abc import abstractmethod
from typing import Dict, Optional, Type
from overrides import overrides, EnforceOverrides


class ChromaError(Exception, EnforceOverrides):
    trace_id: Optional[str] = None

    def code(self) -> int:
        """Return an appropriate HTTP response code for this error"""
        return 400  # Bad Request

    def message(self) -> str:
        return ", ".join(self.args)

    @classmethod
    @abstractmethod
    def name(cls) -> str:
        """Return the error name"""
        pass


class InvalidDimensionException(ChromaError):
    @classmethod
    @overrides
    def name(cls) -> str:
        return "InvalidDimension"


class IDAlreadyExistsError(ChromaError):
    @overrides
    def code(self) -> int:
        return 409  # Conflict

    @classmethod
    @overrides
    def name(cls) -> str:
        return "IDAlreadyExists"


class ChromaAuthError(ChromaError):
    @overrides
    def code(self) -> int:
        return 403

    @classmethod
    @overrides
    def name(cls) -> str:
        return "AuthError"

    @overrides
    def message(self) -> str:
        return "Forbidden"


class DuplicateIDError(ChromaError):
    @classmethod
    @overrides
    def name(cls) -> str:
        return "DuplicateID"


class InvalidArgumentError(ChromaError):
    @overrides
    def code(self) -> int:
        return 400

    @classmethod
    @overrides
    def name(cls) -> str:
        return "InvalidArgument"


class InvalidUUIDError(ChromaError):
    @classmethod
    @overrides
    def name(cls) -> str:
        return "InvalidUUID"


class InvalidHTTPVersion(ChromaError):
    @classmethod
    @overrides
    def name(cls) -> str:
        return "InvalidHTTPVersion"


class AuthorizationError(ChromaError):
    @overrides
    def code(self) -> int:
        return 401

    @classmethod
    @overrides
    def name(cls) -> str:
        return "AuthorizationError"


class NotFoundError(ChromaError):
    @overrides
    def code(self) -> int:
        return 404

    @classmethod
    @overrides
    def name(cls) -> str:
        return "NotFoundError"


class UniqueConstraintError(ChromaError):
    @overrides
    def code(self) -> int:
        return 409

    @classmethod
    @overrides
    def name(cls) -> str:
        return "UniqueConstraintError"


class BatchSizeExceededError(ChromaError):
    @overrides
    def code(self) -> int:
        return 413

    @classmethod
    @overrides
    def name(cls) -> str:
        return "BatchSizeExceededError"


class VersionMismatchError(ChromaError):
    @overrides
    def code(self) -> int:
        return 500

    @classmethod
    @overrides
    def name(cls) -> str:
        return "VersionMismatchError"


class InternalError(ChromaError):
    @overrides
    def code(self) -> int:
        return 500

    @classmethod
    @overrides
    def name(cls) -> str:
        return "InternalError"


class RateLimitError(ChromaError):
    @overrides
    def code(self) -> int:
        return 429

    @classmethod
    @overrides
    def name(cls) -> str:
        return "RateLimitError"


class QuotaError(ChromaError):
    @overrides
    def code(self) -> int:
        return 400

    @classmethod
    @overrides
    def name(cls) -> str:
        return "QuotaError"


error_types: Dict[str, Type[ChromaError]] = {
    "InvalidDimension": InvalidDimensionException,
    "InvalidArgumentError": InvalidArgumentError,
    "IDAlreadyExists": IDAlreadyExistsError,
    "DuplicateID": DuplicateIDError,
    "InvalidUUID": InvalidUUIDError,
    "InvalidHTTPVersion": InvalidHTTPVersion,
    "AuthorizationError": AuthorizationError,
    "NotFoundError": NotFoundError,
    "BatchSizeExceededError": BatchSizeExceededError,
    "VersionMismatchError": VersionMismatchError,
    "RateLimitError": RateLimitError,
    "AuthError": ChromaAuthError,
    "UniqueConstraintError": UniqueConstraintError,
    "QuotaError": QuotaError,
    "InternalError": InternalError,
    # Catch-all for any other errors
    "ChromaError": ChromaError,
}
