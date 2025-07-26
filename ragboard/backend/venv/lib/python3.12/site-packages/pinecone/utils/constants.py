import os
import enum

from .version import __version__

MAX_MSG_SIZE = 128 * 1024 * 1024

MAX_ID_LENGTH = int(os.getenv("PINECONE_MAX_ID_LENGTH", default="64"))

REQUEST_ID: str = "request_id"
CLIENT_VERSION_HEADER = "X-Pinecone-Client-Version"


class NodeType(str, enum.Enum):
    STANDARD = "STANDARD"
    COMPUTE = "COMPUTE"
    MEMORY = "MEMORY"
    STANDARD2X = "STANDARD2X"
    COMPUTE2X = "COMPUTE2X"
    MEMORY2X = "MEMORY2X"
    STANDARD4X = "STANDARD4X"
    COMPUTE4X = "COMPUTE4X"
    MEMORY4X = "MEMORY4X"


CLIENT_VERSION = __version__
CLIENT_ID = f"python-client-{CLIENT_VERSION}"

REQUIRED_VECTOR_FIELDS = {"id", "values"}
OPTIONAL_VECTOR_FIELDS = {"sparse_values", "metadata"}
