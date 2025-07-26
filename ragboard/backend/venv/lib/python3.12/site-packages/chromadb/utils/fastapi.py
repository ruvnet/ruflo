from uuid import UUID
from starlette.responses import JSONResponse

from chromadb.errors import ChromaError, InvalidUUIDError


def fastapi_json_response(error: ChromaError) -> JSONResponse:
    return JSONResponse(
        content={"error": error.name(), "message": error.message()},
        status_code=error.code(),
    )


def string_to_uuid(uuid_str: str) -> UUID:
    try:
        return UUID(uuid_str)
    except ValueError:
        raise InvalidUUIDError(f"Could not parse {uuid_str} as a UUID")
