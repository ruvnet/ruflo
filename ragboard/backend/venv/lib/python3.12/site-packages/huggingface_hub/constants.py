import os
import re
import typing
from typing import Literal, Optional, Tuple


# Possible values for env variables


ENV_VARS_TRUE_VALUES = {"1", "ON", "YES", "TRUE"}
ENV_VARS_TRUE_AND_AUTO_VALUES = ENV_VARS_TRUE_VALUES.union({"AUTO"})


def _is_true(value: Optional[str]) -> bool:
    if value is None:
        return False
    return value.upper() in ENV_VARS_TRUE_VALUES


def _as_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    return int(value)


# Constants for file downloads

PYTORCH_WEIGHTS_NAME = "pytorch_model.bin"
TF2_WEIGHTS_NAME = "tf_model.h5"
TF_WEIGHTS_NAME = "model.ckpt"
FLAX_WEIGHTS_NAME = "flax_model.msgpack"
CONFIG_NAME = "config.json"
REPOCARD_NAME = "README.md"
DEFAULT_ETAG_TIMEOUT = 10
DEFAULT_DOWNLOAD_TIMEOUT = 10
DEFAULT_REQUEST_TIMEOUT = 10
DOWNLOAD_CHUNK_SIZE = 10 * 1024 * 1024
HF_TRANSFER_CONCURRENCY = 100
MAX_HTTP_DOWNLOAD_SIZE = 50 * 1000 * 1000 * 1000  # 50 GB

# Constants for serialization

PYTORCH_WEIGHTS_FILE_PATTERN = "pytorch_model{suffix}.bin"  # Unsafe pickle: use safetensors instead
SAFETENSORS_WEIGHTS_FILE_PATTERN = "model{suffix}.safetensors"
TF2_WEIGHTS_FILE_PATTERN = "tf_model{suffix}.h5"

# Constants for safetensors repos

SAFETENSORS_SINGLE_FILE = "model.safetensors"
SAFETENSORS_INDEX_FILE = "model.safetensors.index.json"
SAFETENSORS_MAX_HEADER_LENGTH = 25_000_000

# Timeout of aquiring file lock and logging the attempt
FILELOCK_LOG_EVERY_SECONDS = 10

# Git-related constants

DEFAULT_REVISION = "main"
REGEX_COMMIT_OID = re.compile(r"[A-Fa-f0-9]{5,40}")

HUGGINGFACE_CO_URL_HOME = "https://huggingface.co/"

_staging_mode = _is_true(os.environ.get("HUGGINGFACE_CO_STAGING"))

_HF_DEFAULT_ENDPOINT = "https://huggingface.co"
_HF_DEFAULT_STAGING_ENDPOINT = "https://hub-ci.huggingface.co"
ENDPOINT = os.getenv("HF_ENDPOINT", _HF_DEFAULT_ENDPOINT).rstrip("/")
HUGGINGFACE_CO_URL_TEMPLATE = ENDPOINT + "/{repo_id}/resolve/{revision}/{filename}"

if _staging_mode:
    ENDPOINT = _HF_DEFAULT_STAGING_ENDPOINT
    HUGGINGFACE_CO_URL_TEMPLATE = _HF_DEFAULT_STAGING_ENDPOINT + "/{repo_id}/resolve/{revision}/{filename}"

HUGGINGFACE_HEADER_X_REPO_COMMIT = "X-Repo-Commit"
HUGGINGFACE_HEADER_X_LINKED_ETAG = "X-Linked-Etag"
HUGGINGFACE_HEADER_X_LINKED_SIZE = "X-Linked-Size"
HUGGINGFACE_HEADER_X_BILL_TO = "X-HF-Bill-To"

INFERENCE_ENDPOINT = os.environ.get("HF_INFERENCE_ENDPOINT", "https://api-inference.huggingface.co")

# See https://huggingface.co/docs/inference-endpoints/index
INFERENCE_ENDPOINTS_ENDPOINT = "https://api.endpoints.huggingface.cloud/v2"
INFERENCE_CATALOG_ENDPOINT = "https://endpoints.huggingface.co/api/catalog"

# See https://api.endpoints.huggingface.cloud/#post-/v2/endpoint/-namespace-
INFERENCE_ENDPOINT_IMAGE_KEYS = [
    "custom",
    "huggingface",
    "huggingfaceNeuron",
    "llamacpp",
    "tei",
    "tgi",
    "tgiNeuron",
]

# Proxy for third-party providers
INFERENCE_PROXY_TEMPLATE = "https://router.huggingface.co/{provider}"

REPO_ID_SEPARATOR = "--"
# ^ this substring is not allowed in repo_ids on hf.co
# and is the canonical one we use for serialization of repo ids elsewhere.


REPO_TYPE_DATASET = "dataset"
REPO_TYPE_SPACE = "space"
REPO_TYPE_MODEL = "model"
REPO_TYPES = [None, REPO_TYPE_MODEL, REPO_TYPE_DATASET, REPO_TYPE_SPACE]
SPACES_SDK_TYPES = ["gradio", "streamlit", "docker", "static"]

REPO_TYPES_URL_PREFIXES = {
    REPO_TYPE_DATASET: "datasets/",
    REPO_TYPE_SPACE: "spaces/",
}
REPO_TYPES_MAPPING = {
    "datasets": REPO_TYPE_DATASET,
    "spaces": REPO_TYPE_SPACE,
    "models": REPO_TYPE_MODEL,
}

DiscussionTypeFilter = Literal["all", "discussion", "pull_request"]
DISCUSSION_TYPES: Tuple[DiscussionTypeFilter, ...] = typing.get_args(DiscussionTypeFilter)
DiscussionStatusFilter = Literal["all", "open", "closed"]
DISCUSSION_STATUS: Tuple[DiscussionTypeFilter, ...] = typing.get_args(DiscussionStatusFilter)

# Webhook subscription types
WEBHOOK_DOMAIN_T = Literal["repo", "discussions"]

# default cache
default_home = os.path.join(os.path.expanduser("~"), ".cache")
HF_HOME = os.path.expandvars(
    os.path.expanduser(
        os.getenv(
            "HF_HOME",
            os.path.join(os.getenv("XDG_CACHE_HOME", default_home), "huggingface"),
        )
    )
)
hf_cache_home = HF_HOME  # for backward compatibility. TODO: remove this in 1.0.0

default_cache_path = os.path.join(HF_HOME, "hub")
default_assets_cache_path = os.path.join(HF_HOME, "assets")

# Legacy env variables
HUGGINGFACE_HUB_CACHE = os.getenv("HUGGINGFACE_HUB_CACHE", default_cache_path)
HUGGINGFACE_ASSETS_CACHE = os.getenv("HUGGINGFACE_ASSETS_CACHE", default_assets_cache_path)

# New env variables
HF_HUB_CACHE = os.path.expandvars(
    os.path.expanduser(
        os.getenv(
            "HF_HUB_CACHE",
            HUGGINGFACE_HUB_CACHE,
        )
    )
)
HF_ASSETS_CACHE = os.path.expandvars(
    os.path.expanduser(
        os.getenv(
            "HF_ASSETS_CACHE",
            HUGGINGFACE_ASSETS_CACHE,
        )
    )
)

HF_HUB_OFFLINE = _is_true(os.environ.get("HF_HUB_OFFLINE") or os.environ.get("TRANSFORMERS_OFFLINE"))

# If set, log level will be set to DEBUG and all requests made to the Hub will be logged
# as curl commands for reproducibility.
HF_DEBUG = _is_true(os.environ.get("HF_DEBUG"))

# Opt-out from telemetry requests
HF_HUB_DISABLE_TELEMETRY = (
    _is_true(os.environ.get("HF_HUB_DISABLE_TELEMETRY"))  # HF-specific env variable
    or _is_true(os.environ.get("DISABLE_TELEMETRY"))
    or _is_true(os.environ.get("DO_NOT_TRACK"))  # https://consoledonottrack.com/
)

HF_TOKEN_PATH = os.path.expandvars(
    os.path.expanduser(
        os.getenv(
            "HF_TOKEN_PATH",
            os.path.join(HF_HOME, "token"),
        )
    )
)
HF_STORED_TOKENS_PATH = os.path.join(os.path.dirname(HF_TOKEN_PATH), "stored_tokens")

if _staging_mode:
    # In staging mode, we use a different cache to ensure we don't mix up production and staging data or tokens
    # In practice in `huggingface_hub` tests, we monkeypatch these values with temporary directories. The following
    # lines are only used in third-party libraries tests (e.g. `transformers`, `diffusers`, etc.).
    _staging_home = os.path.join(os.path.expanduser("~"), ".cache", "huggingface_staging")
    HUGGINGFACE_HUB_CACHE = os.path.join(_staging_home, "hub")
    HF_TOKEN_PATH = os.path.join(_staging_home, "token")

# Here, `True` will disable progress bars globally without possibility of enabling it
# programmatically. `False` will enable them without possibility of disabling them.
# If environment variable is not set (None), then the user is free to enable/disable
# them programmatically.
# TL;DR: env variable has priority over code
__HF_HUB_DISABLE_PROGRESS_BARS = os.environ.get("HF_HUB_DISABLE_PROGRESS_BARS")
HF_HUB_DISABLE_PROGRESS_BARS: Optional[bool] = (
    _is_true(__HF_HUB_DISABLE_PROGRESS_BARS) if __HF_HUB_DISABLE_PROGRESS_BARS is not None else None
)

# Disable warning on machines that do not support symlinks (e.g. Windows non-developer)
HF_HUB_DISABLE_SYMLINKS_WARNING: bool = _is_true(os.environ.get("HF_HUB_DISABLE_SYMLINKS_WARNING"))

# Disable warning when using experimental features
HF_HUB_DISABLE_EXPERIMENTAL_WARNING: bool = _is_true(os.environ.get("HF_HUB_DISABLE_EXPERIMENTAL_WARNING"))

# Disable sending the cached token by default is all HTTP requests to the Hub
HF_HUB_DISABLE_IMPLICIT_TOKEN: bool = _is_true(os.environ.get("HF_HUB_DISABLE_IMPLICIT_TOKEN"))

# Enable fast-download using external dependency "hf_transfer"
# See:
# - https://pypi.org/project/hf-transfer/
# - https://github.com/huggingface/hf_transfer (private)
HF_HUB_ENABLE_HF_TRANSFER: bool = _is_true(os.environ.get("HF_HUB_ENABLE_HF_TRANSFER"))


# UNUSED
# We don't use symlinks in local dir anymore.
HF_HUB_LOCAL_DIR_AUTO_SYMLINK_THRESHOLD: int = (
    _as_int(os.environ.get("HF_HUB_LOCAL_DIR_AUTO_SYMLINK_THRESHOLD")) or 5 * 1024 * 1024
)

# Used to override the etag timeout on a system level
HF_HUB_ETAG_TIMEOUT: int = _as_int(os.environ.get("HF_HUB_ETAG_TIMEOUT")) or DEFAULT_ETAG_TIMEOUT

# Used to override the get request timeout on a system level
HF_HUB_DOWNLOAD_TIMEOUT: int = _as_int(os.environ.get("HF_HUB_DOWNLOAD_TIMEOUT")) or DEFAULT_DOWNLOAD_TIMEOUT

# Allows to add information about the requester in the user-agent (eg. partner name)
HF_HUB_USER_AGENT_ORIGIN: Optional[str] = os.environ.get("HF_HUB_USER_AGENT_ORIGIN")

# List frameworks that are handled by the InferenceAPI service. Useful to scan endpoints and check which models are
# deployed and running. Since 95% of the models are using the top 4 frameworks listed below, we scan only those by
# default. We still keep the full list of supported frameworks in case we want to scan all of them.
MAIN_INFERENCE_API_FRAMEWORKS = [
    "diffusers",
    "sentence-transformers",
    "text-generation-inference",
    "transformers",
]

ALL_INFERENCE_API_FRAMEWORKS = MAIN_INFERENCE_API_FRAMEWORKS + [
    "adapter-transformers",
    "allennlp",
    "asteroid",
    "bertopic",
    "doctr",
    "espnet",
    "fairseq",
    "fastai",
    "fasttext",
    "flair",
    "k2",
    "keras",
    "mindspore",
    "nemo",
    "open_clip",
    "paddlenlp",
    "peft",
    "pyannote-audio",
    "sklearn",
    "spacy",
    "span-marker",
    "speechbrain",
    "stanza",
    "timm",
]

# If OAuth didn't work after 2 redirects, there's likely a third-party cookie issue in the Space iframe view.
# In this case, we redirect the user to the non-iframe view.
OAUTH_MAX_REDIRECTS = 2

# OAuth-related environment variables injected by the Space
OAUTH_CLIENT_ID = os.environ.get("OAUTH_CLIENT_ID")
OAUTH_CLIENT_SECRET = os.environ.get("OAUTH_CLIENT_SECRET")
OAUTH_SCOPES = os.environ.get("OAUTH_SCOPES")
OPENID_PROVIDER_URL = os.environ.get("OPENID_PROVIDER_URL")

# Xet constants
HUGGINGFACE_HEADER_X_XET_ENDPOINT = "X-Xet-Cas-Url"
HUGGINGFACE_HEADER_X_XET_ACCESS_TOKEN = "X-Xet-Access-Token"
HUGGINGFACE_HEADER_X_XET_EXPIRATION = "X-Xet-Token-Expiration"
HUGGINGFACE_HEADER_X_XET_HASH = "X-Xet-Hash"
HUGGINGFACE_HEADER_X_XET_REFRESH_ROUTE = "X-Xet-Refresh-Route"
HUGGINGFACE_HEADER_LINK_XET_AUTH_KEY = "xet-auth"

default_xet_cache_path = os.path.join(HF_HOME, "xet")
HF_XET_CACHE = os.getenv("HF_XET_CACHE", default_xet_cache_path)
