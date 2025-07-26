from .core.client.exceptions import (
    PineconeException,
    PineconeApiAttributeError,
    PineconeApiTypeError,
    PineconeApiValueError,
    PineconeApiKeyError,
    PineconeApiException,
    NotFoundException,
    UnauthorizedException,
    ForbiddenException,
    ServiceException,
)

class PineconeProtocolError(PineconeException):
    """Raised when something unexpected happens mid-request/response."""

class PineconeConfigurationError(PineconeException):
    """Raised when a configuration error occurs."""

__all__ = [
    "PineconeConfigurationError",
    "PineconeProtocolError",
    "PineconeException",
    "PineconeApiAttributeError",
    "PineconeApiTypeError",
    "PineconeApiValueError",
    "PineconeApiKeyError",
    "PineconeApiException",
    "NotFoundException",
    "UnauthorizedException",
    "ForbiddenException",
    "ServiceException",
]
