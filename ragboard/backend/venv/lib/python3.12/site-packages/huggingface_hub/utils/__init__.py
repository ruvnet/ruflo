# coding=utf-8
# Copyright 2021 The HuggingFace Inc. team. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License

# ruff: noqa: F401
from huggingface_hub.errors import (
    BadRequestError,
    CacheNotFound,
    CorruptedCacheException,
    DisabledRepoError,
    EntryNotFoundError,
    FileMetadataError,
    GatedRepoError,
    HfHubHTTPError,
    HFValidationError,
    LocalEntryNotFoundError,
    LocalTokenNotFoundError,
    NotASafetensorsRepoError,
    OfflineModeIsEnabled,
    RepositoryNotFoundError,
    RevisionNotFoundError,
    SafetensorsParsingError,
)

from . import tqdm as _tqdm  # _tqdm is the module
from ._auth import get_stored_tokens, get_token
from ._cache_assets import cached_assets_path
from ._cache_manager import (
    CachedFileInfo,
    CachedRepoInfo,
    CachedRevisionInfo,
    DeleteCacheStrategy,
    HFCacheInfo,
    scan_cache_dir,
)
from ._chunk_utils import chunk_iterable
from ._datetime import parse_datetime
from ._experimental import experimental
from ._fixes import SoftTemporaryDirectory, WeakFileLock, yaml_dump
from ._git_credential import list_credential_helpers, set_git_credential, unset_git_credential
from ._headers import build_hf_headers, get_token_to_send
from ._hf_folder import HfFolder
from ._http import (
    configure_http_backend,
    fix_hf_endpoint_in_url,
    get_session,
    hf_raise_for_status,
    http_backoff,
    reset_sessions,
)
from ._pagination import paginate
from ._paths import DEFAULT_IGNORE_PATTERNS, FORBIDDEN_FOLDERS, filter_repo_objects
from ._runtime import (
    dump_environment_info,
    get_aiohttp_version,
    get_fastai_version,
    get_fastapi_version,
    get_fastcore_version,
    get_gradio_version,
    get_graphviz_version,
    get_hf_hub_version,
    get_hf_transfer_version,
    get_jinja_version,
    get_numpy_version,
    get_pillow_version,
    get_pydantic_version,
    get_pydot_version,
    get_python_version,
    get_tensorboard_version,
    get_tf_version,
    get_torch_version,
    is_aiohttp_available,
    is_colab_enterprise,
    is_fastai_available,
    is_fastapi_available,
    is_fastcore_available,
    is_google_colab,
    is_gradio_available,
    is_graphviz_available,
    is_hf_transfer_available,
    is_jinja_available,
    is_notebook,
    is_numpy_available,
    is_package_available,
    is_pillow_available,
    is_pydantic_available,
    is_pydot_available,
    is_safetensors_available,
    is_tensorboard_available,
    is_tf_available,
    is_torch_available,
)
from ._safetensors import SafetensorsFileMetadata, SafetensorsRepoMetadata, TensorInfo
from ._subprocess import capture_output, run_interactive_subprocess, run_subprocess
from ._telemetry import send_telemetry
from ._typing import is_jsonable, is_simple_optional_type, unwrap_simple_optional_type
from ._validators import smoothly_deprecate_use_auth_token, validate_hf_hub_args, validate_repo_id
from ._xet import (
    XetConnectionInfo,
    XetFileData,
    XetTokenType,
    fetch_xet_connection_info_from_repo_info,
    parse_xet_file_data_from_response,
    refresh_xet_connection_info,
)
from .tqdm import are_progress_bars_disabled, disable_progress_bars, enable_progress_bars, tqdm, tqdm_stream_file
