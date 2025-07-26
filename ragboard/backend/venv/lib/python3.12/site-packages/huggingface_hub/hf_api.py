# coding=utf-8
# Copyright 2019-present, the HuggingFace Inc. team.
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
# limitations under the License.
from __future__ import annotations

import inspect
import io
import json
import re
import struct
import warnings
from collections import defaultdict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime
from functools import wraps
from itertools import islice
from pathlib import Path
from typing import (
    TYPE_CHECKING,
    Any,
    BinaryIO,
    Callable,
    Dict,
    Iterable,
    Iterator,
    List,
    Literal,
    Optional,
    Tuple,
    Type,
    TypeVar,
    Union,
    overload,
)
from urllib.parse import quote, unquote

import requests
from requests.exceptions import HTTPError
from tqdm.auto import tqdm as base_tqdm
from tqdm.contrib.concurrent import thread_map

from . import constants
from ._commit_api import (
    CommitOperation,
    CommitOperationAdd,
    CommitOperationCopy,
    CommitOperationDelete,
    _fetch_files_to_copy,
    _fetch_upload_modes,
    _prepare_commit_payload,
    _upload_lfs_files,
    _upload_xet_files,
    _warn_on_overwriting_operations,
)
from ._inference_endpoints import InferenceEndpoint, InferenceEndpointType
from ._space_api import SpaceHardware, SpaceRuntime, SpaceStorage, SpaceVariable
from ._upload_large_folder import upload_large_folder_internal
from .community import (
    Discussion,
    DiscussionComment,
    DiscussionStatusChange,
    DiscussionTitleChange,
    DiscussionWithDetails,
    deserialize_event,
)
from .constants import (
    DEFAULT_ETAG_TIMEOUT,  # noqa: F401 # kept for backward compatibility
    DEFAULT_REQUEST_TIMEOUT,  # noqa: F401 # kept for backward compatibility
    DEFAULT_REVISION,  # noqa: F401 # kept for backward compatibility
    DISCUSSION_STATUS,  # noqa: F401 # kept for backward compatibility
    DISCUSSION_TYPES,  # noqa: F401 # kept for backward compatibility
    ENDPOINT,  # noqa: F401 # kept for backward compatibility
    INFERENCE_ENDPOINTS_ENDPOINT,  # noqa: F401 # kept for backward compatibility
    REGEX_COMMIT_OID,  # noqa: F401 # kept for backward compatibility
    REPO_TYPE_MODEL,  # noqa: F401 # kept for backward compatibility
    REPO_TYPES,  # noqa: F401 # kept for backward compatibility
    REPO_TYPES_MAPPING,  # noqa: F401 # kept for backward compatibility
    REPO_TYPES_URL_PREFIXES,  # noqa: F401 # kept for backward compatibility
    SAFETENSORS_INDEX_FILE,  # noqa: F401 # kept for backward compatibility
    SAFETENSORS_MAX_HEADER_LENGTH,  # noqa: F401 # kept for backward compatibility
    SAFETENSORS_SINGLE_FILE,  # noqa: F401 # kept for backward compatibility
    SPACES_SDK_TYPES,  # noqa: F401 # kept for backward compatibility
    WEBHOOK_DOMAIN_T,  # noqa: F401 # kept for backward compatibility
    DiscussionStatusFilter,  # noqa: F401 # kept for backward compatibility
    DiscussionTypeFilter,  # noqa: F401 # kept for backward compatibility
)
from .errors import (
    BadRequestError,
    EntryNotFoundError,
    GatedRepoError,
    HfHubHTTPError,
    RepositoryNotFoundError,
    RevisionNotFoundError,
)
from .file_download import HfFileMetadata, get_hf_file_metadata, hf_hub_url
from .repocard_data import DatasetCardData, ModelCardData, SpaceCardData
from .utils import (
    DEFAULT_IGNORE_PATTERNS,
    HfFolder,  # noqa: F401 # kept for backward compatibility
    LocalTokenNotFoundError,
    NotASafetensorsRepoError,
    SafetensorsFileMetadata,
    SafetensorsParsingError,
    SafetensorsRepoMetadata,
    TensorInfo,
    build_hf_headers,
    chunk_iterable,
    experimental,
    filter_repo_objects,
    fix_hf_endpoint_in_url,
    get_session,
    get_token,
    hf_raise_for_status,
    logging,
    paginate,
    parse_datetime,
    validate_hf_hub_args,
)
from .utils import tqdm as hf_tqdm
from .utils._auth import _get_token_from_environment, _get_token_from_file, _get_token_from_google_colab
from .utils._deprecation import _deprecate_method
from .utils._runtime import is_xet_available
from .utils._typing import CallableT
from .utils.endpoint_helpers import _is_emission_within_threshold


if TYPE_CHECKING:
    from .inference._providers import PROVIDER_T

R = TypeVar("R")  # Return type
CollectionItemType_T = Literal["model", "dataset", "space", "paper", "collection"]

ExpandModelProperty_T = Literal[
    "author",
    "baseModels",
    "cardData",
    "childrenModelCount",
    "config",
    "createdAt",
    "disabled",
    "downloads",
    "downloadsAllTime",
    "gated",
    "gguf",
    "inference",
    "inferenceProviderMapping",
    "lastModified",
    "library_name",
    "likes",
    "mask_token",
    "model-index",
    "pipeline_tag",
    "private",
    "resourceGroup",
    "safetensors",
    "sha",
    "siblings",
    "spaces",
    "tags",
    "transformersInfo",
    "trendingScore",
    "usedStorage",
    "widgetData",
    "xetEnabled",
]

ExpandDatasetProperty_T = Literal[
    "author",
    "cardData",
    "citation",
    "createdAt",
    "description",
    "disabled",
    "downloads",
    "downloadsAllTime",
    "gated",
    "lastModified",
    "likes",
    "paperswithcode_id",
    "private",
    "resourceGroup",
    "sha",
    "siblings",
    "tags",
    "trendingScore",
    "usedStorage",
    "xetEnabled",
]

ExpandSpaceProperty_T = Literal[
    "author",
    "cardData",
    "createdAt",
    "datasets",
    "disabled",
    "lastModified",
    "likes",
    "models",
    "private",
    "resourceGroup",
    "runtime",
    "sdk",
    "sha",
    "siblings",
    "subdomain",
    "tags",
    "trendingScore",
    "usedStorage",
    "xetEnabled",
]

USERNAME_PLACEHOLDER = "hf_user"
_REGEX_DISCUSSION_URL = re.compile(r".*/discussions/(\d+)$")

_CREATE_COMMIT_NO_REPO_ERROR_MESSAGE = (
    "\nNote: Creating a commit assumes that the repo already exists on the"
    " Huggingface Hub. Please use `create_repo` if it's not the case."
)
_AUTH_CHECK_NO_REPO_ERROR_MESSAGE = (
    "\nNote: The repository either does not exist or you do not have access rights."
    " Please check the repository ID and your access permissions."
    " If this is a private repository, ensure that your token is correct."
)
logger = logging.get_logger(__name__)


def repo_type_and_id_from_hf_id(hf_id: str, hub_url: Optional[str] = None) -> Tuple[Optional[str], Optional[str], str]:
    """
    Returns the repo type and ID from a huggingface.co URL linking to a
    repository

    Args:
        hf_id (`str`):
            An URL or ID of a repository on the HF hub. Accepted values are:

            - https://huggingface.co/<repo_type>/<namespace>/<repo_id>
            - https://huggingface.co/<namespace>/<repo_id>
            - hf://<repo_type>/<namespace>/<repo_id>
            - hf://<namespace>/<repo_id>
            - <repo_type>/<namespace>/<repo_id>
            - <namespace>/<repo_id>
            - <repo_id>
        hub_url (`str`, *optional*):
            The URL of the HuggingFace Hub, defaults to https://huggingface.co

    Returns:
        A tuple with three items: repo_type (`str` or `None`), namespace (`str` or
        `None`) and repo_id (`str`).

    Raises:
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If URL cannot be parsed.
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If `repo_type` is unknown.
    """
    input_hf_id = hf_id

    hub_url = re.sub(r"https?://", "", hub_url if hub_url is not None else constants.ENDPOINT)
    is_hf_url = hub_url in hf_id and "@" not in hf_id

    HFFS_PREFIX = "hf://"
    if hf_id.startswith(HFFS_PREFIX):  # Remove "hf://" prefix if exists
        hf_id = hf_id[len(HFFS_PREFIX) :]

    url_segments = hf_id.split("/")
    is_hf_id = len(url_segments) <= 3

    namespace: Optional[str]
    if is_hf_url:
        namespace, repo_id = url_segments[-2:]
        if namespace == hub_url:
            namespace = None
        if len(url_segments) > 2 and hub_url not in url_segments[-3]:
            repo_type = url_segments[-3]
        elif namespace in constants.REPO_TYPES_MAPPING:
            # Mean canonical dataset or model
            repo_type = constants.REPO_TYPES_MAPPING[namespace]
            namespace = None
        else:
            repo_type = None
    elif is_hf_id:
        if len(url_segments) == 3:
            # Passed <repo_type>/<user>/<model_id> or <repo_type>/<org>/<model_id>
            repo_type, namespace, repo_id = url_segments[-3:]
        elif len(url_segments) == 2:
            if url_segments[0] in constants.REPO_TYPES_MAPPING:
                # Passed '<model_id>' or 'datasets/<dataset_id>' for a canonical model or dataset
                repo_type = constants.REPO_TYPES_MAPPING[url_segments[0]]
                namespace = None
                repo_id = hf_id.split("/")[-1]
            else:
                # Passed <user>/<model_id> or <org>/<model_id>
                namespace, repo_id = hf_id.split("/")[-2:]
                repo_type = None
        else:
            # Passed <model_id>
            repo_id = url_segments[0]
            namespace, repo_type = None, None
    else:
        raise ValueError(f"Unable to retrieve user and repo ID from the passed HF ID: {hf_id}")

    # Check if repo type is known (mapping "spaces" => "space" + empty value => `None`)
    if repo_type in constants.REPO_TYPES_MAPPING:
        repo_type = constants.REPO_TYPES_MAPPING[repo_type]
    if repo_type == "":
        repo_type = None
    if repo_type not in constants.REPO_TYPES:
        raise ValueError(f"Unknown `repo_type`: '{repo_type}' ('{input_hf_id}')")

    return repo_type, namespace, repo_id


@dataclass
class LastCommitInfo(dict):
    oid: str
    title: str
    date: datetime

    def __post_init__(self):  # hack to make LastCommitInfo backward compatible
        self.update(asdict(self))


@dataclass
class BlobLfsInfo(dict):
    size: int
    sha256: str
    pointer_size: int

    def __post_init__(self):  # hack to make BlobLfsInfo backward compatible
        self.update(asdict(self))


@dataclass
class BlobSecurityInfo(dict):
    safe: bool  # duplicate information with "status" field, keeping it for backward compatibility
    status: str
    av_scan: Optional[Dict]
    pickle_import_scan: Optional[Dict]

    def __post_init__(self):  # hack to make BlogSecurityInfo backward compatible
        self.update(asdict(self))


@dataclass
class TransformersInfo(dict):
    auto_model: str
    custom_class: Optional[str] = None
    # possible `pipeline_tag` values: https://github.com/huggingface/huggingface.js/blob/3ee32554b8620644a6287e786b2a83bf5caf559c/packages/tasks/src/pipelines.ts#L72
    pipeline_tag: Optional[str] = None
    processor: Optional[str] = None

    def __post_init__(self):  # hack to make TransformersInfo backward compatible
        self.update(asdict(self))


@dataclass
class SafeTensorsInfo(dict):
    parameters: Dict[str, int]
    total: int

    def __post_init__(self):  # hack to make SafeTensorsInfo backward compatible
        self.update(asdict(self))


@dataclass
class CommitInfo(str):
    """Data structure containing information about a newly created commit.

    Returned by any method that creates a commit on the Hub: [`create_commit`], [`upload_file`], [`upload_folder`],
    [`delete_file`], [`delete_folder`]. It inherits from `str` for backward compatibility but using methods specific
    to `str` is deprecated.

    Attributes:
        commit_url (`str`):
            Url where to find the commit.

        commit_message (`str`):
            The summary (first line) of the commit that has been created.

        commit_description (`str`):
            Description of the commit that has been created. Can be empty.

        oid (`str`):
            Commit hash id. Example: `"91c54ad1727ee830252e457677f467be0bfd8a57"`.

        pr_url (`str`, *optional*):
            Url to the PR that has been created, if any. Populated when `create_pr=True`
            is passed.

        pr_revision (`str`, *optional*):
            Revision of the PR that has been created, if any. Populated when
            `create_pr=True` is passed. Example: `"refs/pr/1"`.

        pr_num (`int`, *optional*):
            Number of the PR discussion that has been created, if any. Populated when
            `create_pr=True` is passed. Can be passed as `discussion_num` in
            [`get_discussion_details`]. Example: `1`.

        repo_url (`RepoUrl`):
            Repo URL of the commit containing info like repo_id, repo_type, etc.

        _url (`str`, *optional*):
            Legacy url for `str` compatibility. Can be the url to the uploaded file on the Hub (if returned by
            [`upload_file`]), to the uploaded folder on the Hub (if returned by [`upload_folder`]) or to the commit on
            the Hub (if returned by [`create_commit`]). Defaults to `commit_url`. It is deprecated to use this
            attribute. Please use `commit_url` instead.
    """

    commit_url: str
    commit_message: str
    commit_description: str
    oid: str
    pr_url: Optional[str] = None

    # Computed from `commit_url` in `__post_init__`
    repo_url: RepoUrl = field(init=False)

    # Computed from `pr_url` in `__post_init__`
    pr_revision: Optional[str] = field(init=False)
    pr_num: Optional[str] = field(init=False)

    # legacy url for `str` compatibility (ex: url to uploaded file, url to uploaded folder, url to PR, etc.)
    _url: str = field(repr=False, default=None)  # type: ignore  # defaults to `commit_url`

    def __new__(cls, *args, commit_url: str, _url: Optional[str] = None, **kwargs):
        return str.__new__(cls, _url or commit_url)

    def __post_init__(self):
        """Populate pr-related fields after initialization.

        See https://docs.python.org/3.10/library/dataclasses.html#post-init-processing.
        """
        # Repo info
        self.repo_url = RepoUrl(self.commit_url.split("/commit/")[0])

        # PR info
        if self.pr_url is not None:
            self.pr_revision = _parse_revision_from_pr_url(self.pr_url)
            self.pr_num = int(self.pr_revision.split("/")[-1])
        else:
            self.pr_revision = None
            self.pr_num = None


@dataclass
class AccessRequest:
    """Data structure containing information about a user access request.

    Attributes:
        username (`str`):
            Username of the user who requested access.
        fullname (`str`):
            Fullname of the user who requested access.
        email (`Optional[str]`):
            Email of the user who requested access.
            Can only be `None` in the /accepted list if the user was granted access manually.
        timestamp (`datetime`):
            Timestamp of the request.
        status (`Literal["pending", "accepted", "rejected"]`):
            Status of the request. Can be one of `["pending", "accepted", "rejected"]`.
        fields (`Dict[str, Any]`, *optional*):
            Additional fields filled by the user in the gate form.
    """

    username: str
    fullname: str
    email: Optional[str]
    timestamp: datetime
    status: Literal["pending", "accepted", "rejected"]

    # Additional fields filled by the user in the gate form
    fields: Optional[Dict[str, Any]] = None


@dataclass
class WebhookWatchedItem:
    """Data structure containing information about the items watched by a webhook.

    Attributes:
        type (`Literal["dataset", "model", "org", "space", "user"]`):
            Type of the item to be watched. Can be one of `["dataset", "model", "org", "space", "user"]`.
        name (`str`):
            Name of the item to be watched. Can be the username, organization name, model name, dataset name or space name.
    """

    type: Literal["dataset", "model", "org", "space", "user"]
    name: str


@dataclass
class WebhookInfo:
    """Data structure containing information about a webhook.

    Attributes:
        id (`str`):
            ID of the webhook.
        url (`str`):
            URL of the webhook.
        watched (`List[WebhookWatchedItem]`):
            List of items watched by the webhook, see [`WebhookWatchedItem`].
        domains (`List[WEBHOOK_DOMAIN_T]`):
            List of domains the webhook is watching. Can be one of `["repo", "discussions"]`.
        secret (`str`, *optional*):
            Secret of the webhook.
        disabled (`bool`):
            Whether the webhook is disabled or not.
    """

    id: str
    url: str
    watched: List[WebhookWatchedItem]
    domains: List[constants.WEBHOOK_DOMAIN_T]
    secret: Optional[str]
    disabled: bool


class RepoUrl(str):
    """Subclass of `str` describing a repo URL on the Hub.

    `RepoUrl` is returned by `HfApi.create_repo`. It inherits from `str` for backward
    compatibility. At initialization, the URL is parsed to populate properties:
    - endpoint (`str`)
    - namespace (`Optional[str]`)
    - repo_name (`str`)
    - repo_id (`str`)
    - repo_type (`Literal["model", "dataset", "space"]`)
    - url (`str`)

    Args:
        url (`Any`):
            String value of the repo url.
        endpoint (`str`, *optional*):
            Endpoint of the Hub. Defaults to <https://huggingface.co>.

    Example:
    ```py
    >>> RepoUrl('https://huggingface.co/gpt2')
    RepoUrl('https://huggingface.co/gpt2', endpoint='https://huggingface.co', repo_type='model', repo_id='gpt2')

    >>> RepoUrl('https://hub-ci.huggingface.co/datasets/dummy_user/dummy_dataset', endpoint='https://hub-ci.huggingface.co')
    RepoUrl('https://hub-ci.huggingface.co/datasets/dummy_user/dummy_dataset', endpoint='https://hub-ci.huggingface.co', repo_type='dataset', repo_id='dummy_user/dummy_dataset')

    >>> RepoUrl('hf://datasets/my-user/my-dataset')
    RepoUrl('hf://datasets/my-user/my-dataset', endpoint='https://huggingface.co', repo_type='dataset', repo_id='user/dataset')

    >>> HfApi.create_repo("dummy_model")
    RepoUrl('https://huggingface.co/Wauplin/dummy_model', endpoint='https://huggingface.co', repo_type='model', repo_id='Wauplin/dummy_model')
    ```

    Raises:
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If URL cannot be parsed.
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If `repo_type` is unknown.
    """

    def __new__(cls, url: Any, endpoint: Optional[str] = None):
        url = fix_hf_endpoint_in_url(url, endpoint=endpoint)
        return super(RepoUrl, cls).__new__(cls, url)

    def __init__(self, url: Any, endpoint: Optional[str] = None) -> None:
        super().__init__()
        # Parse URL
        self.endpoint = endpoint or constants.ENDPOINT
        repo_type, namespace, repo_name = repo_type_and_id_from_hf_id(self, hub_url=self.endpoint)

        # Populate fields
        self.namespace = namespace
        self.repo_name = repo_name
        self.repo_id = repo_name if namespace is None else f"{namespace}/{repo_name}"
        self.repo_type = repo_type or constants.REPO_TYPE_MODEL
        self.url = str(self)  # just in case it's needed

    def __repr__(self) -> str:
        return f"RepoUrl('{self}', endpoint='{self.endpoint}', repo_type='{self.repo_type}', repo_id='{self.repo_id}')"


@dataclass
class RepoSibling:
    """
    Contains basic information about a repo file inside a repo on the Hub.

    <Tip>

    All attributes of this class are optional except `rfilename`. This is because only the file names are returned when
    listing repositories on the Hub (with [`list_models`], [`list_datasets`] or [`list_spaces`]). If you need more
    information like file size, blob id or lfs details, you must request them specifically from one repo at a time
    (using [`model_info`], [`dataset_info`] or [`space_info`]) as it adds more constraints on the backend server to
    retrieve these.

    </Tip>

    Attributes:
        rfilename (str):
            file name, relative to the repo root.
        size (`int`, *optional*):
            The file's size, in bytes. This attribute is defined when `files_metadata` argument of [`repo_info`] is set
            to `True`. It's `None` otherwise.
        blob_id (`str`, *optional*):
            The file's git OID. This attribute is defined when `files_metadata` argument of [`repo_info`] is set to
            `True`. It's `None` otherwise.
        lfs (`BlobLfsInfo`, *optional*):
            The file's LFS metadata. This attribute is defined when`files_metadata` argument of [`repo_info`] is set to
            `True` and the file is stored with Git LFS. It's `None` otherwise.
    """

    rfilename: str
    size: Optional[int] = None
    blob_id: Optional[str] = None
    lfs: Optional[BlobLfsInfo] = None


@dataclass
class RepoFile:
    """
    Contains information about a file on the Hub.

    Attributes:
        path (str):
            file path relative to the repo root.
        size (`int`):
            The file's size, in bytes.
        blob_id (`str`):
            The file's git OID.
        lfs (`BlobLfsInfo`):
            The file's LFS metadata.
        last_commit (`LastCommitInfo`, *optional*):
            The file's last commit metadata. Only defined if [`list_repo_tree`] and [`get_paths_info`]
            are called with `expand=True`.
        security (`BlobSecurityInfo`, *optional*):
            The file's security scan metadata. Only defined if [`list_repo_tree`] and [`get_paths_info`]
            are called with `expand=True`.
    """

    path: str
    size: int
    blob_id: str
    lfs: Optional[BlobLfsInfo] = None
    last_commit: Optional[LastCommitInfo] = None
    security: Optional[BlobSecurityInfo] = None

    def __init__(self, **kwargs):
        self.path = kwargs.pop("path")
        self.size = kwargs.pop("size")
        self.blob_id = kwargs.pop("oid")
        lfs = kwargs.pop("lfs", None)
        if lfs is not None:
            lfs = BlobLfsInfo(size=lfs["size"], sha256=lfs["oid"], pointer_size=lfs["pointerSize"])
        self.lfs = lfs
        last_commit = kwargs.pop("lastCommit", None) or kwargs.pop("last_commit", None)
        if last_commit is not None:
            last_commit = LastCommitInfo(
                oid=last_commit["id"], title=last_commit["title"], date=parse_datetime(last_commit["date"])
            )
        self.last_commit = last_commit
        security = kwargs.pop("securityFileStatus", None)
        if security is not None:
            safe = security["status"] == "safe"
            security = BlobSecurityInfo(
                safe=safe,
                status=security["status"],
                av_scan=security["avScan"],
                pickle_import_scan=security["pickleImportScan"],
            )
        self.security = security

        # backwards compatibility
        self.rfilename = self.path
        self.lastCommit = self.last_commit


@dataclass
class RepoFolder:
    """
    Contains information about a folder on the Hub.

    Attributes:
        path (str):
            folder path relative to the repo root.
        tree_id (`str`):
            The folder's git OID.
        last_commit (`LastCommitInfo`, *optional*):
            The folder's last commit metadata. Only defined if [`list_repo_tree`] and [`get_paths_info`]
            are called with `expand=True`.
    """

    path: str
    tree_id: str
    last_commit: Optional[LastCommitInfo] = None

    def __init__(self, **kwargs):
        self.path = kwargs.pop("path")
        self.tree_id = kwargs.pop("oid")
        last_commit = kwargs.pop("lastCommit", None) or kwargs.pop("last_commit", None)
        if last_commit is not None:
            last_commit = LastCommitInfo(
                oid=last_commit["id"], title=last_commit["title"], date=parse_datetime(last_commit["date"])
            )
        self.last_commit = last_commit


@dataclass
class InferenceProviderMapping:
    provider: "PROVIDER_T"  # Provider name
    hf_model_id: str  # ID of the model on the Hugging Face Hub
    provider_id: str  # ID of the model on the provider's side
    status: Literal["error", "live", "staging"]
    task: str

    adapter: Optional[str] = None
    adapter_weights_path: Optional[str] = None
    type: Optional[Literal["single-model", "tag-filter"]] = None

    def __init__(self, **kwargs):
        self.provider = kwargs.pop("provider")
        self.hf_model_id = kwargs.pop("hf_model_id")
        self.provider_id = kwargs.pop("providerId")
        self.status = kwargs.pop("status")
        self.task = kwargs.pop("task")

        self.adapter = kwargs.pop("adapter", None)
        self.adapter_weights_path = kwargs.pop("adapterWeightsPath", None)
        self.type = kwargs.pop("type", None)
        self.__dict__.update(**kwargs)


@dataclass
class ModelInfo:
    """
    Contains information about a model on the Hub.

    <Tip>

    Most attributes of this class are optional. This is because the data returned by the Hub depends on the query made.
    In general, the more specific the query, the more information is returned. On the contrary, when listing models
    using [`list_models`] only a subset of the attributes are returned.

    </Tip>

    Attributes:
        id (`str`):
            ID of model.
        author (`str`, *optional*):
            Author of the model.
        sha (`str`, *optional*):
            Repo SHA at this particular revision.
        created_at (`datetime`, *optional*):
            Date of creation of the repo on the Hub. Note that the lowest value is `2022-03-02T23:29:04.000Z`,
            corresponding to the date when we began to store creation dates.
        last_modified (`datetime`, *optional*):
            Date of last commit to the repo.
        private (`bool`):
            Is the repo private.
        disabled (`bool`, *optional*):
            Is the repo disabled.
        downloads (`int`):
            Number of downloads of the model over the last 30 days.
        downloads_all_time (`int`):
            Cumulated number of downloads of the model since its creation.
        gated (`Literal["auto", "manual", False]`, *optional*):
            Is the repo gated.
            If so, whether there is manual or automatic approval.
        gguf (`Dict`, *optional*):
            GGUF information of the model.
        inference (`Literal["warm"]`, *optional*):
            Status of the model on Inference Providers. Warm if the model is served by at least one provider.
        inference_provider_mapping (`List[InferenceProviderMapping]`, *optional*):
            A list of [`InferenceProviderMapping`] ordered after the user's provider order.
        likes (`int`):
            Number of likes of the model.
        library_name (`str`, *optional*):
            Library associated with the model.
        tags (`List[str]`):
            List of tags of the model. Compared to `card_data.tags`, contains extra tags computed by the Hub
            (e.g. supported libraries, model's arXiv).
        pipeline_tag (`str`, *optional*):
            Pipeline tag associated with the model.
        mask_token (`str`, *optional*):
            Mask token used by the model.
        widget_data (`Any`, *optional*):
            Widget data associated with the model.
        model_index (`Dict`, *optional*):
            Model index for evaluation.
        config (`Dict`, *optional*):
            Model configuration.
        transformers_info (`TransformersInfo`, *optional*):
            Transformers-specific info (auto class, processor, etc.) associated with the model.
        trending_score (`int`, *optional*):
            Trending score of the model.
        card_data (`ModelCardData`, *optional*):
            Model Card Metadata  as a [`huggingface_hub.repocard_data.ModelCardData`] object.
        siblings (`List[RepoSibling]`):
            List of [`huggingface_hub.hf_api.RepoSibling`] objects that constitute the model.
        spaces (`List[str]`, *optional*):
            List of spaces using the model.
        safetensors (`SafeTensorsInfo`, *optional*):
            Model's safetensors information.
        security_repo_status (`Dict`, *optional*):
            Model's security scan status.
    """

    id: str
    author: Optional[str]
    sha: Optional[str]
    created_at: Optional[datetime]
    last_modified: Optional[datetime]
    private: Optional[bool]
    disabled: Optional[bool]
    downloads: Optional[int]
    downloads_all_time: Optional[int]
    gated: Optional[Literal["auto", "manual", False]]
    gguf: Optional[Dict]
    inference: Optional[Literal["warm"]]
    inference_provider_mapping: Optional[List[InferenceProviderMapping]]
    likes: Optional[int]
    library_name: Optional[str]
    tags: Optional[List[str]]
    pipeline_tag: Optional[str]
    mask_token: Optional[str]
    card_data: Optional[ModelCardData]
    widget_data: Optional[Any]
    model_index: Optional[Dict]
    config: Optional[Dict]
    transformers_info: Optional[TransformersInfo]
    trending_score: Optional[int]
    siblings: Optional[List[RepoSibling]]
    spaces: Optional[List[str]]
    safetensors: Optional[SafeTensorsInfo]
    security_repo_status: Optional[Dict]
    xet_enabled: Optional[bool]

    def __init__(self, **kwargs):
        self.id = kwargs.pop("id")
        self.author = kwargs.pop("author", None)
        self.sha = kwargs.pop("sha", None)
        last_modified = kwargs.pop("lastModified", None) or kwargs.pop("last_modified", None)
        self.last_modified = parse_datetime(last_modified) if last_modified else None
        created_at = kwargs.pop("createdAt", None) or kwargs.pop("created_at", None)
        self.created_at = parse_datetime(created_at) if created_at else None
        self.private = kwargs.pop("private", None)
        self.gated = kwargs.pop("gated", None)
        self.disabled = kwargs.pop("disabled", None)
        self.downloads = kwargs.pop("downloads", None)
        self.downloads_all_time = kwargs.pop("downloadsAllTime", None)
        self.likes = kwargs.pop("likes", None)
        self.library_name = kwargs.pop("library_name", None)
        self.gguf = kwargs.pop("gguf", None)

        self.inference = kwargs.pop("inference", None)

        # little hack to simplify Inference Providers logic and make it backward and forward compatible
        # right now, API returns a dict on model_info and a list on list_models. Let's harmonize to list.
        mapping = kwargs.pop("inferenceProviderMapping", None)
        if isinstance(mapping, list):
            self.inference_provider_mapping = [
                InferenceProviderMapping(**{**value, "hf_model_id": self.id}) for value in mapping
            ]
        elif isinstance(mapping, dict):
            self.inference_provider_mapping = [
                InferenceProviderMapping(**{**value, "hf_model_id": self.id, "provider": provider})
                for provider, value in mapping.items()
            ]
        elif mapping is None:
            self.inference_provider_mapping = None
        else:
            raise ValueError(
                f"Unexpected type for `inferenceProviderMapping`. Expecting `dict` or `list`. Got {mapping}."
            )

        self.tags = kwargs.pop("tags", None)
        self.pipeline_tag = kwargs.pop("pipeline_tag", None)
        self.mask_token = kwargs.pop("mask_token", None)
        self.trending_score = kwargs.pop("trendingScore", None)

        card_data = kwargs.pop("cardData", None) or kwargs.pop("card_data", None)
        self.card_data = (
            ModelCardData(**card_data, ignore_metadata_errors=True) if isinstance(card_data, dict) else card_data
        )

        self.widget_data = kwargs.pop("widgetData", None)
        self.model_index = kwargs.pop("model-index", None) or kwargs.pop("model_index", None)
        self.config = kwargs.pop("config", None)
        transformers_info = kwargs.pop("transformersInfo", None) or kwargs.pop("transformers_info", None)
        self.transformers_info = TransformersInfo(**transformers_info) if transformers_info else None
        siblings = kwargs.pop("siblings", None)
        self.siblings = (
            [
                RepoSibling(
                    rfilename=sibling["rfilename"],
                    size=sibling.get("size"),
                    blob_id=sibling.get("blobId"),
                    lfs=(
                        BlobLfsInfo(
                            size=sibling["lfs"]["size"],
                            sha256=sibling["lfs"]["sha256"],
                            pointer_size=sibling["lfs"]["pointerSize"],
                        )
                        if sibling.get("lfs")
                        else None
                    ),
                )
                for sibling in siblings
            ]
            if siblings is not None
            else None
        )
        self.spaces = kwargs.pop("spaces", None)
        safetensors = kwargs.pop("safetensors", None)
        self.safetensors = (
            SafeTensorsInfo(
                parameters=safetensors["parameters"],
                total=safetensors["total"],
            )
            if safetensors
            else None
        )
        self.security_repo_status = kwargs.pop("securityRepoStatus", None)
        self.xet_enabled = kwargs.pop("xetEnabled", None)
        # backwards compatibility
        self.lastModified = self.last_modified
        self.cardData = self.card_data
        self.transformersInfo = self.transformers_info
        self.__dict__.update(**kwargs)


@dataclass
class DatasetInfo:
    """
    Contains information about a dataset on the Hub.

    <Tip>

    Most attributes of this class are optional. This is because the data returned by the Hub depends on the query made.
    In general, the more specific the query, the more information is returned. On the contrary, when listing datasets
    using [`list_datasets`] only a subset of the attributes are returned.

    </Tip>

    Attributes:
        id (`str`):
            ID of dataset.
        author (`str`):
            Author of the dataset.
        sha (`str`):
            Repo SHA at this particular revision.
        created_at (`datetime`, *optional*):
            Date of creation of the repo on the Hub. Note that the lowest value is `2022-03-02T23:29:04.000Z`,
            corresponding to the date when we began to store creation dates.
        last_modified (`datetime`, *optional*):
            Date of last commit to the repo.
        private (`bool`):
            Is the repo private.
        disabled (`bool`, *optional*):
            Is the repo disabled.
        gated (`Literal["auto", "manual", False]`, *optional*):
            Is the repo gated.
            If so, whether there is manual or automatic approval.
        downloads (`int`):
            Number of downloads of the dataset over the last 30 days.
        downloads_all_time (`int`):
            Cumulated number of downloads of the model since its creation.
        likes (`int`):
            Number of likes of the dataset.
        tags (`List[str]`):
            List of tags of the dataset.
        card_data (`DatasetCardData`, *optional*):
            Model Card Metadata  as a [`huggingface_hub.repocard_data.DatasetCardData`] object.
        siblings (`List[RepoSibling]`):
            List of [`huggingface_hub.hf_api.RepoSibling`] objects that constitute the dataset.
        paperswithcode_id (`str`, *optional*):
            Papers with code ID of the dataset.
        trending_score (`int`, *optional*):
            Trending score of the dataset.
    """

    id: str
    author: Optional[str]
    sha: Optional[str]
    created_at: Optional[datetime]
    last_modified: Optional[datetime]
    private: Optional[bool]
    gated: Optional[Literal["auto", "manual", False]]
    disabled: Optional[bool]
    downloads: Optional[int]
    downloads_all_time: Optional[int]
    likes: Optional[int]
    paperswithcode_id: Optional[str]
    tags: Optional[List[str]]
    trending_score: Optional[int]
    card_data: Optional[DatasetCardData]
    siblings: Optional[List[RepoSibling]]
    xet_enabled: Optional[bool]

    def __init__(self, **kwargs):
        self.id = kwargs.pop("id")
        self.author = kwargs.pop("author", None)
        self.sha = kwargs.pop("sha", None)
        created_at = kwargs.pop("createdAt", None) or kwargs.pop("created_at", None)
        self.created_at = parse_datetime(created_at) if created_at else None
        last_modified = kwargs.pop("lastModified", None) or kwargs.pop("last_modified", None)
        self.last_modified = parse_datetime(last_modified) if last_modified else None
        self.private = kwargs.pop("private", None)
        self.gated = kwargs.pop("gated", None)
        self.disabled = kwargs.pop("disabled", None)
        self.downloads = kwargs.pop("downloads", None)
        self.downloads_all_time = kwargs.pop("downloadsAllTime", None)
        self.likes = kwargs.pop("likes", None)
        self.paperswithcode_id = kwargs.pop("paperswithcode_id", None)
        self.tags = kwargs.pop("tags", None)
        self.trending_score = kwargs.pop("trendingScore", None)

        card_data = kwargs.pop("cardData", None) or kwargs.pop("card_data", None)
        self.card_data = (
            DatasetCardData(**card_data, ignore_metadata_errors=True) if isinstance(card_data, dict) else card_data
        )
        siblings = kwargs.pop("siblings", None)
        self.siblings = (
            [
                RepoSibling(
                    rfilename=sibling["rfilename"],
                    size=sibling.get("size"),
                    blob_id=sibling.get("blobId"),
                    lfs=(
                        BlobLfsInfo(
                            size=sibling["lfs"]["size"],
                            sha256=sibling["lfs"]["sha256"],
                            pointer_size=sibling["lfs"]["pointerSize"],
                        )
                        if sibling.get("lfs")
                        else None
                    ),
                )
                for sibling in siblings
            ]
            if siblings is not None
            else None
        )
        self.xet_enabled = kwargs.pop("xetEnabled", None)
        # backwards compatibility
        self.lastModified = self.last_modified
        self.cardData = self.card_data
        self.__dict__.update(**kwargs)


@dataclass
class SpaceInfo:
    """
    Contains information about a Space on the Hub.

    <Tip>

    Most attributes of this class are optional. This is because the data returned by the Hub depends on the query made.
    In general, the more specific the query, the more information is returned. On the contrary, when listing spaces
    using [`list_spaces`] only a subset of the attributes are returned.

    </Tip>

    Attributes:
        id (`str`):
            ID of the Space.
        author (`str`, *optional*):
            Author of the Space.
        sha (`str`, *optional*):
            Repo SHA at this particular revision.
        created_at (`datetime`, *optional*):
            Date of creation of the repo on the Hub. Note that the lowest value is `2022-03-02T23:29:04.000Z`,
            corresponding to the date when we began to store creation dates.
        last_modified (`datetime`, *optional*):
            Date of last commit to the repo.
        private (`bool`):
            Is the repo private.
        gated (`Literal["auto", "manual", False]`, *optional*):
            Is the repo gated.
            If so, whether there is manual or automatic approval.
        disabled (`bool`, *optional*):
            Is the Space disabled.
        host (`str`, *optional*):
            Host URL of the Space.
        subdomain (`str`, *optional*):
            Subdomain of the Space.
        likes (`int`):
            Number of likes of the Space.
        tags (`List[str]`):
            List of tags of the Space.
        siblings (`List[RepoSibling]`):
            List of [`huggingface_hub.hf_api.RepoSibling`] objects that constitute the Space.
        card_data (`SpaceCardData`, *optional*):
            Space Card Metadata  as a [`huggingface_hub.repocard_data.SpaceCardData`] object.
        runtime (`SpaceRuntime`, *optional*):
            Space runtime information as a [`huggingface_hub.hf_api.SpaceRuntime`] object.
        sdk (`str`, *optional*):
            SDK used by the Space.
        models (`List[str]`, *optional*):
            List of models used by the Space.
        datasets (`List[str]`, *optional*):
            List of datasets used by the Space.
        trending_score (`int`, *optional*):
            Trending score of the Space.
    """

    id: str
    author: Optional[str]
    sha: Optional[str]
    created_at: Optional[datetime]
    last_modified: Optional[datetime]
    private: Optional[bool]
    gated: Optional[Literal["auto", "manual", False]]
    disabled: Optional[bool]
    host: Optional[str]
    subdomain: Optional[str]
    likes: Optional[int]
    sdk: Optional[str]
    tags: Optional[List[str]]
    siblings: Optional[List[RepoSibling]]
    trending_score: Optional[int]
    card_data: Optional[SpaceCardData]
    runtime: Optional[SpaceRuntime]
    models: Optional[List[str]]
    datasets: Optional[List[str]]
    xet_enabled: Optional[bool]

    def __init__(self, **kwargs):
        self.id = kwargs.pop("id")
        self.author = kwargs.pop("author", None)
        self.sha = kwargs.pop("sha", None)
        created_at = kwargs.pop("createdAt", None) or kwargs.pop("created_at", None)
        self.created_at = parse_datetime(created_at) if created_at else None
        last_modified = kwargs.pop("lastModified", None) or kwargs.pop("last_modified", None)
        self.last_modified = parse_datetime(last_modified) if last_modified else None
        self.private = kwargs.pop("private", None)
        self.gated = kwargs.pop("gated", None)
        self.disabled = kwargs.pop("disabled", None)
        self.host = kwargs.pop("host", None)
        self.subdomain = kwargs.pop("subdomain", None)
        self.likes = kwargs.pop("likes", None)
        self.sdk = kwargs.pop("sdk", None)
        self.tags = kwargs.pop("tags", None)
        self.trending_score = kwargs.pop("trendingScore", None)
        card_data = kwargs.pop("cardData", None) or kwargs.pop("card_data", None)
        self.card_data = (
            SpaceCardData(**card_data, ignore_metadata_errors=True) if isinstance(card_data, dict) else card_data
        )
        siblings = kwargs.pop("siblings", None)
        self.siblings = (
            [
                RepoSibling(
                    rfilename=sibling["rfilename"],
                    size=sibling.get("size"),
                    blob_id=sibling.get("blobId"),
                    lfs=(
                        BlobLfsInfo(
                            size=sibling["lfs"]["size"],
                            sha256=sibling["lfs"]["sha256"],
                            pointer_size=sibling["lfs"]["pointerSize"],
                        )
                        if sibling.get("lfs")
                        else None
                    ),
                )
                for sibling in siblings
            ]
            if siblings is not None
            else None
        )
        runtime = kwargs.pop("runtime", None)
        self.runtime = SpaceRuntime(runtime) if runtime else None
        self.models = kwargs.pop("models", None)
        self.datasets = kwargs.pop("datasets", None)
        self.xet_enabled = kwargs.pop("xetEnabled", None)
        # backwards compatibility
        self.lastModified = self.last_modified
        self.cardData = self.card_data
        self.__dict__.update(**kwargs)


@dataclass
class CollectionItem:
    """
    Contains information about an item of a Collection (model, dataset, Space, paper or collection).

    Attributes:
        item_object_id (`str`):
            Unique ID of the item in the collection.
        item_id (`str`):
            ID of the underlying object on the Hub. Can be either a repo_id, a paper id or a collection slug.
            e.g. `"jbilcke-hf/ai-comic-factory"`, `"2307.09288"`, `"celinah/cerebras-function-calling-682607169c35fbfa98b30b9a"`.
        item_type (`str`):
            Type of the underlying object. Can be one of `"model"`, `"dataset"`, `"space"`, `"paper"` or `"collection"`.
        position (`int`):
            Position of the item in the collection.
        note (`str`, *optional*):
            Note associated with the item, as plain text.
    """

    item_object_id: str  # id in database
    item_id: str  # repo_id or paper id
    item_type: str
    position: int
    note: Optional[str] = None

    def __init__(
        self,
        _id: str,
        id: str,
        type: CollectionItemType_T,
        position: int,
        note: Optional[Dict] = None,
        **kwargs,
    ) -> None:
        self.item_object_id: str = _id  # id in database
        self.item_id: str = id  # repo_id or paper id
        # if the item is a collection, override item_id with the slug
        slug = kwargs.get("slug")
        if slug is not None:
            self.item_id = slug  # collection slug
        self.item_type: CollectionItemType_T = type
        self.position: int = position
        self.note: str = note["text"] if note is not None else None


@dataclass
class Collection:
    """
    Contains information about a Collection on the Hub.

    Attributes:
        slug (`str`):
            Slug of the collection. E.g. `"TheBloke/recent-models-64f9a55bb3115b4f513ec026"`.
        title (`str`):
            Title of the collection. E.g. `"Recent models"`.
        owner (`str`):
            Owner of the collection. E.g. `"TheBloke"`.
        items (`List[CollectionItem]`):
            List of items in the collection.
        last_updated (`datetime`):
            Date of the last update of the collection.
        position (`int`):
            Position of the collection in the list of collections of the owner.
        private (`bool`):
            Whether the collection is private or not.
        theme (`str`):
            Theme of the collection. E.g. `"green"`.
        upvotes (`int`):
            Number of upvotes of the collection.
        description (`str`, *optional*):
            Description of the collection, as plain text.
        url (`str`):
            (property) URL of the collection on the Hub.
    """

    slug: str
    title: str
    owner: str
    items: List[CollectionItem]
    last_updated: datetime
    position: int
    private: bool
    theme: str
    upvotes: int
    description: Optional[str] = None

    def __init__(self, **kwargs) -> None:
        self.slug = kwargs.pop("slug")
        self.title = kwargs.pop("title")
        self.owner = kwargs.pop("owner")
        self.items = [CollectionItem(**item) for item in kwargs.pop("items")]
        self.last_updated = parse_datetime(kwargs.pop("lastUpdated"))
        self.position = kwargs.pop("position")
        self.private = kwargs.pop("private")
        self.theme = kwargs.pop("theme")
        self.upvotes = kwargs.pop("upvotes")
        self.description = kwargs.pop("description", None)
        endpoint = kwargs.pop("endpoint", None)
        if endpoint is None:
            endpoint = constants.ENDPOINT
        self._url = f"{endpoint}/collections/{self.slug}"

    @property
    def url(self) -> str:
        """Returns the URL of the collection on the Hub."""
        return self._url


@dataclass
class GitRefInfo:
    """
    Contains information about a git reference for a repo on the Hub.

    Attributes:
        name (`str`):
            Name of the reference (e.g. tag name or branch name).
        ref (`str`):
            Full git ref on the Hub (e.g. `"refs/heads/main"` or `"refs/tags/v1.0"`).
        target_commit (`str`):
            OID of the target commit for the ref (e.g. `"e7da7f221d5bf496a48136c0cd264e630fe9fcc8"`)
    """

    name: str
    ref: str
    target_commit: str


@dataclass
class GitRefs:
    """
    Contains information about all git references for a repo on the Hub.

    Object is returned by [`list_repo_refs`].

    Attributes:
        branches (`List[GitRefInfo]`):
            A list of [`GitRefInfo`] containing information about branches on the repo.
        converts (`List[GitRefInfo]`):
            A list of [`GitRefInfo`] containing information about "convert" refs on the repo.
            Converts are refs used (internally) to push preprocessed data in Dataset repos.
        tags (`List[GitRefInfo]`):
            A list of [`GitRefInfo`] containing information about tags on the repo.
        pull_requests (`List[GitRefInfo]`, *optional*):
            A list of [`GitRefInfo`] containing information about pull requests on the repo.
            Only returned if `include_prs=True` is set.
    """

    branches: List[GitRefInfo]
    converts: List[GitRefInfo]
    tags: List[GitRefInfo]
    pull_requests: Optional[List[GitRefInfo]] = None


@dataclass
class GitCommitInfo:
    """
    Contains information about a git commit for a repo on the Hub. Check out [`list_repo_commits`] for more details.

    Attributes:
        commit_id (`str`):
            OID of the commit (e.g. `"e7da7f221d5bf496a48136c0cd264e630fe9fcc8"`)
        authors (`List[str]`):
            List of authors of the commit.
        created_at (`datetime`):
            Datetime when the commit was created.
        title (`str`):
            Title of the commit. This is a free-text value entered by the authors.
        message (`str`):
            Description of the commit. This is a free-text value entered by the authors.
        formatted_title (`str`):
            Title of the commit formatted as HTML. Only returned if `formatted=True` is set.
        formatted_message (`str`):
            Description of the commit formatted as HTML. Only returned if `formatted=True` is set.
    """

    commit_id: str

    authors: List[str]
    created_at: datetime
    title: str
    message: str

    formatted_title: Optional[str]
    formatted_message: Optional[str]


@dataclass
class UserLikes:
    """
    Contains information about a user likes on the Hub.

    Attributes:
        user (`str`):
            Name of the user for which we fetched the likes.
        total (`int`):
            Total number of likes.
        datasets (`List[str]`):
            List of datasets liked by the user (as repo_ids).
        models (`List[str]`):
            List of models liked by the user (as repo_ids).
        spaces (`List[str]`):
            List of spaces liked by the user (as repo_ids).
    """

    # Metadata
    user: str
    total: int

    # User likes
    datasets: List[str]
    models: List[str]
    spaces: List[str]


@dataclass
class Organization:
    """
    Contains information about an organization on the Hub.

    Attributes:
        avatar_url (`str`):
            URL of the organization's avatar.
        name (`str`):
            Name of the organization on the Hub (unique).
        fullname (`str`):
            Organization's full name.
    """

    avatar_url: str
    name: str
    fullname: str

    def __init__(self, **kwargs) -> None:
        self.avatar_url = kwargs.pop("avatarUrl", "")
        self.name = kwargs.pop("name", "")
        self.fullname = kwargs.pop("fullname", "")

        # forward compatibility
        self.__dict__.update(**kwargs)


@dataclass
class User:
    """
    Contains information about a user on the Hub.

    Attributes:
        username (`str`):
            Name of the user on the Hub (unique).
        fullname (`str`):
            User's full name.
        avatar_url (`str`):
            URL of the user's avatar.
        details (`str`, *optional*):
            User's details.
        is_following (`bool`, *optional*):
            Whether the authenticated user is following this user.
        is_pro (`bool`, *optional*):
            Whether the user is a pro user.
        num_models (`int`, *optional*):
            Number of models created by the user.
        num_datasets (`int`, *optional*):
            Number of datasets created by the user.
        num_spaces (`int`, *optional*):
            Number of spaces created by the user.
        num_discussions (`int`, *optional*):
            Number of discussions initiated by the user.
        num_papers (`int`, *optional*):
            Number of papers authored by the user.
        num_upvotes (`int`, *optional*):
            Number of upvotes received by the user.
        num_likes (`int`, *optional*):
            Number of likes given by the user.
        num_following (`int`, *optional*):
            Number of users this user is following.
        num_followers (`int`, *optional*):
            Number of users following this user.
        orgs (list of [`Organization`]):
            List of organizations the user is part of.
    """

    # Metadata
    username: str
    fullname: str
    avatar_url: str
    details: Optional[str] = None
    is_following: Optional[bool] = None
    is_pro: Optional[bool] = None
    num_models: Optional[int] = None
    num_datasets: Optional[int] = None
    num_spaces: Optional[int] = None
    num_discussions: Optional[int] = None
    num_papers: Optional[int] = None
    num_upvotes: Optional[int] = None
    num_likes: Optional[int] = None
    num_following: Optional[int] = None
    num_followers: Optional[int] = None
    orgs: List[Organization] = field(default_factory=list)

    def __init__(self, **kwargs) -> None:
        self.username = kwargs.pop("user", "")
        self.fullname = kwargs.pop("fullname", "")
        self.avatar_url = kwargs.pop("avatarUrl", "")
        self.is_following = kwargs.pop("isFollowing", None)
        self.is_pro = kwargs.pop("isPro", None)
        self.details = kwargs.pop("details", None)
        self.num_models = kwargs.pop("numModels", None)
        self.num_datasets = kwargs.pop("numDatasets", None)
        self.num_spaces = kwargs.pop("numSpaces", None)
        self.num_discussions = kwargs.pop("numDiscussions", None)
        self.num_papers = kwargs.pop("numPapers", None)
        self.num_upvotes = kwargs.pop("numUpvotes", None)
        self.num_likes = kwargs.pop("numLikes", None)
        self.num_following = kwargs.pop("numFollowing", None)
        self.num_followers = kwargs.pop("numFollowers", None)
        self.user_type = kwargs.pop("type", None)
        self.orgs = [Organization(**org) for org in kwargs.pop("orgs", [])]

        # forward compatibility
        self.__dict__.update(**kwargs)


@dataclass
class PaperInfo:
    """
    Contains information about a paper on the Hub.

    Attributes:
        id (`str`):
            arXiv paper ID.
        authors (`List[str]`, **optional**):
            Names of paper authors
        published_at (`datetime`, **optional**):
            Date paper published.
        title (`str`, **optional**):
            Title of the paper.
        summary (`str`, **optional**):
            Summary of the paper.
        upvotes (`int`, **optional**):
            Number of upvotes for the paper on the Hub.
        discussion_id (`str`, **optional**):
            Discussion ID for the paper on the Hub.
        source (`str`, **optional**):
            Source of the paper.
        comments (`int`, **optional**):
            Number of comments for the paper on the Hub.
        submitted_at (`datetime`, **optional**):
            Date paper appeared in daily papers on the Hub.
        submitted_by (`User`, **optional**):
            Information about who submitted the daily paper.
    """

    id: str
    authors: Optional[List[str]]
    published_at: Optional[datetime]
    title: Optional[str]
    summary: Optional[str]
    upvotes: Optional[int]
    discussion_id: Optional[str]
    source: Optional[str]
    comments: Optional[int]
    submitted_at: Optional[datetime]
    submitted_by: Optional[User]

    def __init__(self, **kwargs) -> None:
        paper = kwargs.pop("paper", {})
        self.id = kwargs.pop("id", None) or paper.pop("id", None)
        authors = paper.pop("authors", None) or kwargs.pop("authors", None)
        self.authors = [author.pop("name", None) for author in authors] if authors else None
        published_at = paper.pop("publishedAt", None) or kwargs.pop("publishedAt", None)
        self.published_at = parse_datetime(published_at) if published_at else None
        self.title = kwargs.pop("title", None)
        self.source = kwargs.pop("source", None)
        self.summary = paper.pop("summary", None) or kwargs.pop("summary", None)
        self.upvotes = paper.pop("upvotes", None) or kwargs.pop("upvotes", None)
        self.discussion_id = paper.pop("discussionId", None) or kwargs.pop("discussionId", None)
        self.comments = kwargs.pop("numComments", 0)
        submitted_at = kwargs.pop("publishedAt", None) or kwargs.pop("submittedOnDailyAt", None)
        self.submitted_at = parse_datetime(submitted_at) if submitted_at else None
        submitted_by = kwargs.pop("submittedBy", None) or kwargs.pop("submittedOnDailyBy", None)
        self.submitted_by = User(**submitted_by) if submitted_by else None

        # forward compatibility
        self.__dict__.update(**kwargs)


@dataclass
class LFSFileInfo:
    """
    Contains information about a file stored as LFS on a repo on the Hub.

    Used in the context of listing and permanently deleting LFS files from a repo to free-up space.
    See [`list_lfs_files`] and [`permanently_delete_lfs_files`] for more details.

    Git LFS files are tracked using SHA-256 object IDs, rather than file paths, to optimize performance
    This approach is necessary because a single object can be referenced by multiple paths across different commits,
    making it impractical to search and resolve these connections. Check out [our documentation](https://huggingface.co/docs/hub/storage-limits#advanced-track-lfs-file-references)
    to learn how to know which filename(s) is(are) associated with each SHA.

    Attributes:
        file_oid (`str`):
            SHA-256 object ID of the file. This is the identifier to pass when permanently deleting the file.
        filename (`str`):
            Possible filename for the LFS object. See the note above for more information.
        oid (`str`):
            OID of the LFS object.
        pushed_at (`datetime`):
            Date the LFS object was pushed to the repo.
        ref (`str`, *optional*):
            Ref where the LFS object has been pushed (if any).
        size (`int`):
            Size of the LFS object.

    Example:
        ```py
        >>> from huggingface_hub import HfApi
        >>> api = HfApi()
        >>> lfs_files = api.list_lfs_files("username/my-cool-repo")

        # Filter files files to delete based on a combination of `filename`, `pushed_at`, `ref` or `size`.
        # e.g. select only LFS files in the "checkpoints" folder
        >>> lfs_files_to_delete = (lfs_file for lfs_file in lfs_files if lfs_file.filename.startswith("checkpoints/"))

        # Permanently delete LFS files
        >>> api.permanently_delete_lfs_files("username/my-cool-repo", lfs_files_to_delete)
        ```
    """

    file_oid: str
    filename: str
    oid: str
    pushed_at: datetime
    ref: Optional[str]
    size: int

    def __init__(self, **kwargs) -> None:
        self.file_oid = kwargs.pop("fileOid")
        self.filename = kwargs.pop("filename")
        self.oid = kwargs.pop("oid")
        self.pushed_at = parse_datetime(kwargs.pop("pushedAt"))
        self.ref = kwargs.pop("ref", None)
        self.size = kwargs.pop("size")

        # forward compatibility
        self.__dict__.update(**kwargs)


def future_compatible(fn: CallableT) -> CallableT:
    """Wrap a method of `HfApi` to handle `run_as_future=True`.

    A method flagged as "future_compatible" will be called in a thread if `run_as_future=True` and return a
    `concurrent.futures.Future` instance. Otherwise, it will be called normally and return the result.
    """
    sig = inspect.signature(fn)
    args_params = list(sig.parameters)[1:]  # remove "self" from list

    @wraps(fn)
    def _inner(self, *args, **kwargs):
        # Get `run_as_future` value if provided (default to False)
        if "run_as_future" in kwargs:
            run_as_future = kwargs["run_as_future"]
            kwargs["run_as_future"] = False  # avoid recursion error
        else:
            run_as_future = False
            for param, value in zip(args_params, args):
                if param == "run_as_future":
                    run_as_future = value
                    break

        # Call the function in a thread if `run_as_future=True`
        if run_as_future:
            return self.run_as_future(fn, self, *args, **kwargs)

        # Otherwise, call the function normally
        return fn(self, *args, **kwargs)

    _inner.is_future_compatible = True  # type: ignore
    return _inner  # type: ignore


class HfApi:
    """
    Client to interact with the Hugging Face Hub via HTTP.

    The client is initialized with some high-level settings used in all requests
    made to the Hub (HF endpoint, authentication, user agents...). Using the `HfApi`
    client is preferred but not mandatory as all of its public methods are exposed
    directly at the root of `huggingface_hub`.

    Args:
        endpoint (`str`, *optional*):
            Endpoint of the Hub. Defaults to <https://huggingface.co>.
        token (Union[bool, str, None], optional):
            A valid user access token (string). Defaults to the locally saved
            token, which is the recommended method for authentication (see
            https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
            To disable authentication, pass `False`.
        library_name (`str`, *optional*):
            The name of the library that is making the HTTP request. Will be added to
            the user-agent header. Example: `"transformers"`.
        library_version (`str`, *optional*):
            The version of the library that is making the HTTP request. Will be added
            to the user-agent header. Example: `"4.24.0"`.
        user_agent (`str`, `dict`, *optional*):
            The user agent info in the form of a dictionary or a single string. It will
            be completed with information about the installed packages.
        headers (`dict`, *optional*):
            Additional headers to be sent with each request. Example: `{"X-My-Header": "value"}`.
            Headers passed here are taking precedence over the default headers.
    """

    def __init__(
        self,
        endpoint: Optional[str] = None,
        token: Union[str, bool, None] = None,
        library_name: Optional[str] = None,
        library_version: Optional[str] = None,
        user_agent: Union[Dict, str, None] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        self.endpoint = endpoint if endpoint is not None else constants.ENDPOINT
        self.token = token
        self.library_name = library_name
        self.library_version = library_version
        self.user_agent = user_agent
        self.headers = headers
        self._thread_pool: Optional[ThreadPoolExecutor] = None

    def run_as_future(self, fn: Callable[..., R], *args, **kwargs) -> Future[R]:
        """
        Run a method in the background and return a Future instance.

        The main goal is to run methods without blocking the main thread (e.g. to push data during a training).
        Background jobs are queued to preserve order but are not ran in parallel. If you need to speed-up your scripts
        by parallelizing lots of call to the API, you must setup and use your own [ThreadPoolExecutor](https://docs.python.org/3/library/concurrent.futures.html#threadpoolexecutor).

        Note: Most-used methods like [`upload_file`], [`upload_folder`] and [`create_commit`] have a `run_as_future: bool`
        argument to directly call them in the background. This is equivalent to calling `api.run_as_future(...)` on them
        but less verbose.

        Args:
            fn (`Callable`):
                The method to run in the background.
            *args, **kwargs:
                Arguments with which the method will be called.

        Return:
            `Future`: a [Future](https://docs.python.org/3/library/concurrent.futures.html#future-objects) instance to
            get the result of the task.

        Example:
            ```py
            >>> from huggingface_hub import HfApi
            >>> api = HfApi()
            >>> future = api.run_as_future(api.whoami) # instant
            >>> future.done()
            False
            >>> future.result() # wait until complete and return result
            (...)
            >>> future.done()
            True
            ```
        """
        if self._thread_pool is None:
            self._thread_pool = ThreadPoolExecutor(max_workers=1)
        self._thread_pool
        return self._thread_pool.submit(fn, *args, **kwargs)

    @validate_hf_hub_args
    def whoami(self, token: Union[bool, str, None] = None) -> Dict:
        """
        Call HF API to know "whoami".

        Args:
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        """
        # Get the effective token using the helper function get_token
        effective_token = token or self.token or get_token() or True
        r = get_session().get(
            f"{self.endpoint}/api/whoami-v2",
            headers=self._build_hf_headers(token=effective_token),
        )
        try:
            hf_raise_for_status(r)
        except HTTPError as e:
            error_message = "Invalid user token."
            # Check which token is the effective one and generate the error message accordingly
            if effective_token == _get_token_from_google_colab():
                error_message += " The token from Google Colab vault is invalid. Please update it from the UI."
            elif effective_token == _get_token_from_environment():
                error_message += (
                    " The token from HF_TOKEN environment variable is invalid. "
                    "Note that HF_TOKEN takes precedence over `huggingface-cli login`."
                )
            elif effective_token == _get_token_from_file():
                error_message += " The token stored is invalid. Please run `huggingface-cli login` to update it."
            raise HTTPError(error_message, request=e.request, response=e.response) from e
        return r.json()

    @_deprecate_method(
        version="1.0",
        message=(
            "Permissions are more complex than when `get_token_permission` was first introduced. "
            "OAuth and fine-grain tokens allows for more detailed permissions. "
            "If you need to know the permissions associated with a token, please use `whoami` and check the `'auth'` key."
        ),
    )
    def get_token_permission(
        self, token: Union[bool, str, None] = None
    ) -> Literal["read", "write", "fineGrained", None]:
        """
        Check if a given `token` is valid and return its permissions.

        <Tip warning={true}>

        This method is deprecated and will be removed in version 1.0. Permissions are more complex than when
        `get_token_permission` was first introduced. OAuth and fine-grain tokens allows for more detailed permissions.
        If you need to know the permissions associated with a token, please use `whoami` and check the `'auth'` key.

        </Tip>

        For more details about tokens, please refer to https://huggingface.co/docs/hub/security-tokens#what-are-user-access-tokens.

        Args:
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Literal["read", "write", "fineGrained", None]`: Permission granted by the token ("read" or "write"). Returns `None` if no
            token passed, if token is invalid or if role is not returned by the server. This typically happens when the token is an OAuth token.
        """
        try:
            return self.whoami(token=token)["auth"]["accessToken"]["role"]
        except (LocalTokenNotFoundError, HTTPError, KeyError):
            return None

    def get_model_tags(self) -> Dict:
        """
        List all valid model tags as a nested namespace object
        """
        path = f"{self.endpoint}/api/models-tags-by-type"
        r = get_session().get(path)
        hf_raise_for_status(r)
        return r.json()

    def get_dataset_tags(self) -> Dict:
        """
        List all valid dataset tags as a nested namespace object.
        """
        path = f"{self.endpoint}/api/datasets-tags-by-type"
        r = get_session().get(path)
        hf_raise_for_status(r)
        return r.json()

    @validate_hf_hub_args
    def list_models(
        self,
        *,
        # Search-query parameter
        filter: Union[str, Iterable[str], None] = None,
        author: Optional[str] = None,
        gated: Optional[bool] = None,
        inference: Optional[Literal["warm"]] = None,
        inference_provider: Optional[Union[Literal["all"], "PROVIDER_T", List["PROVIDER_T"]]] = None,
        library: Optional[Union[str, List[str]]] = None,
        language: Optional[Union[str, List[str]]] = None,
        model_name: Optional[str] = None,
        task: Optional[Union[str, List[str]]] = None,
        trained_dataset: Optional[Union[str, List[str]]] = None,
        tags: Optional[Union[str, List[str]]] = None,
        search: Optional[str] = None,
        pipeline_tag: Optional[str] = None,
        emissions_thresholds: Optional[Tuple[float, float]] = None,
        # Sorting and pagination parameters
        sort: Union[Literal["last_modified"], str, None] = None,
        direction: Optional[Literal[-1]] = None,
        limit: Optional[int] = None,
        # Additional data to fetch
        expand: Optional[List[ExpandModelProperty_T]] = None,
        full: Optional[bool] = None,
        cardData: bool = False,
        fetch_config: bool = False,
        token: Union[bool, str, None] = None,
    ) -> Iterable[ModelInfo]:
        """
        List models hosted on the Huggingface Hub, given some filters.

        Args:
            filter (`str` or `Iterable[str]`, *optional*):
                A string or list of string to filter models on the Hub.
            author (`str`, *optional*):
                A string which identify the author (user or organization) of the
                returned models.
            gated (`bool`, *optional*):
                A boolean to filter models on the Hub that are gated or not. By default, all models are returned.
                If `gated=True` is passed, only gated models are returned.
                If `gated=False` is passed, only non-gated models are returned.
            inference (`Literal["warm"]`, *optional*):
                If "warm", filter models on the Hub currently served by at least one provider.
            inference_provider (`Literal["all"]` or `str`, *optional*):
                A string to filter models on the Hub that are served by a specific provider.
                Pass `"all"` to get all models served by at least one provider.
            library (`str` or `List`, *optional*):
                A string or list of strings of foundational libraries models were
                originally trained from, such as pytorch, tensorflow, or allennlp.
            language (`str` or `List`, *optional*):
                A string or list of strings of languages, both by name and country
                code, such as "en" or "English"
            model_name (`str`, *optional*):
                A string that contain complete or partial names for models on the
                Hub, such as "bert" or "bert-base-cased"
            task (`str` or `List`, *optional*):
                A string or list of strings of tasks models were designed for, such
                as: "fill-mask" or "automatic-speech-recognition"
            trained_dataset (`str` or `List`, *optional*):
                A string tag or a list of string tags of the trained dataset for a
                model on the Hub.
            tags (`str` or `List`, *optional*):
                A string tag or a list of tags to filter models on the Hub by, such
                as `text-generation` or `spacy`.
            search (`str`, *optional*):
                A string that will be contained in the returned model ids.
            pipeline_tag (`str`, *optional*):
                A string pipeline tag to filter models on the Hub by, such as `summarization`.
            emissions_thresholds (`Tuple`, *optional*):
                A tuple of two ints or floats representing a minimum and maximum
                carbon footprint to filter the resulting models with in grams.
            sort (`Literal["last_modified"]` or `str`, *optional*):
                The key with which to sort the resulting models. Possible values are "last_modified", "trending_score",
                "created_at", "downloads" and "likes".
            direction (`Literal[-1]` or `int`, *optional*):
                Direction in which to sort. The value `-1` sorts by descending
                order while all other values sort by ascending order.
            limit (`int`, *optional*):
                The limit on the number of models fetched. Leaving this option
                to `None` fetches all models.
            expand (`List[ExpandModelProperty_T]`, *optional*):
                List properties to return in the response. When used, only the properties in the list will be returned.
                This parameter cannot be used if `full`, `cardData` or `fetch_config` are passed.
                Possible values are `"author"`, `"baseModels"`, `"cardData"`, `"childrenModelCount"`, `"config"`, `"createdAt"`, `"disabled"`, `"downloads"`, `"downloadsAllTime"`, `"gated"`, `"gguf"`, `"inference"`, `"inferenceProviderMapping"`, `"lastModified"`, `"library_name"`, `"likes"`, `"mask_token"`, `"model-index"`, `"pipeline_tag"`, `"private"`, `"safetensors"`, `"sha"`, `"siblings"`, `"spaces"`, `"tags"`, `"transformersInfo"`, `"trendingScore"`, `"widgetData"`, `"usedStorage"`, `"resourceGroup"` and `"xetEnabled"`.
            full (`bool`, *optional*):
                Whether to fetch all model data, including the `last_modified`,
                the `sha`, the files and the `tags`. This is set to `True` by
                default when using a filter.
            cardData (`bool`, *optional*):
                Whether to grab the metadata for the model as well. Can contain
                useful information such as carbon emissions, metrics, and
                datasets trained on.
            fetch_config (`bool`, *optional*):
                Whether to fetch the model configs as well. This is not included
                in `full` due to its size.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.


        Returns:
            `Iterable[ModelInfo]`: an iterable of [`huggingface_hub.hf_api.ModelInfo`] objects.

        Example:

        ```python
        >>> from huggingface_hub import HfApi

        >>> api = HfApi()

        # List all models
        >>> api.list_models()

        # List text classification models
        >>> api.list_models(filter="text-classification")

        # List models from the KerasHub library
        >>> api.list_models(filter="keras-hub")

        # List models served by Cohere
        >>> api.list_models(inference_provider="cohere")

        # List models with "bert" in their name
        >>> api.list_models(search="bert")

        # List models with "bert" in their name and pushed by google
        >>> api.list_models(search="bert", author="google")
        ```
        """
        if expand and (full or cardData or fetch_config):
            raise ValueError("`expand` cannot be used if `full`, `cardData` or `fetch_config` are passed.")

        if emissions_thresholds is not None and cardData is None:
            raise ValueError("`emissions_thresholds` were passed without setting `cardData=True`.")

        path = f"{self.endpoint}/api/models"
        headers = self._build_hf_headers(token=token)
        params: Dict[str, Any] = {}

        # Build the filter list
        filter_list: List[str] = []
        if filter:
            filter_list.extend([filter] if isinstance(filter, str) else filter)
        if library:
            filter_list.extend([library] if isinstance(library, str) else library)
        if task:
            filter_list.extend([task] if isinstance(task, str) else task)
        if trained_dataset:
            if isinstance(trained_dataset, str):
                trained_dataset = [trained_dataset]
            for dataset in trained_dataset:
                if not dataset.startswith("dataset:"):
                    dataset = f"dataset:{dataset}"
                filter_list.append(dataset)
        if language:
            filter_list.extend([language] if isinstance(language, str) else language)
        if tags:
            filter_list.extend([tags] if isinstance(tags, str) else tags)
        if len(filter_list) > 0:
            params["filter"] = filter_list

        # Handle other query params
        if author:
            params["author"] = author
        if gated is not None:
            params["gated"] = gated
        if inference is not None:
            params["inference"] = inference
        if inference_provider is not None:
            params["inference_provider"] = inference_provider
        if pipeline_tag:
            params["pipeline_tag"] = pipeline_tag
        search_list = []
        if model_name:
            search_list.append(model_name)
        if search:
            search_list.append(search)
        if len(search_list) > 0:
            params["search"] = search_list
        if sort is not None:
            params["sort"] = (
                "lastModified"
                if sort == "last_modified"
                else "trendingScore"
                if sort == "trending_score"
                else "createdAt"
                if sort == "created_at"
                else sort
            )
        if direction is not None:
            params["direction"] = direction
        if limit is not None:
            params["limit"] = limit

        # Request additional data
        if full:
            params["full"] = True
        if fetch_config:
            params["config"] = True
        if cardData:
            params["cardData"] = True
        if expand:
            params["expand"] = expand

        # `items` is a generator
        items = paginate(path, params=params, headers=headers)
        if limit is not None:
            items = islice(items, limit)  # Do not iterate over all pages
        for item in items:
            if "siblings" not in item:
                item["siblings"] = None
            model_info = ModelInfo(**item)
            if emissions_thresholds is None or _is_emission_within_threshold(model_info, *emissions_thresholds):
                yield model_info

    @validate_hf_hub_args
    def list_datasets(
        self,
        *,
        # Search-query parameter
        filter: Union[str, Iterable[str], None] = None,
        author: Optional[str] = None,
        benchmark: Optional[Union[str, List[str]]] = None,
        dataset_name: Optional[str] = None,
        gated: Optional[bool] = None,
        language_creators: Optional[Union[str, List[str]]] = None,
        language: Optional[Union[str, List[str]]] = None,
        multilinguality: Optional[Union[str, List[str]]] = None,
        size_categories: Optional[Union[str, List[str]]] = None,
        tags: Optional[Union[str, List[str]]] = None,
        task_categories: Optional[Union[str, List[str]]] = None,
        task_ids: Optional[Union[str, List[str]]] = None,
        search: Optional[str] = None,
        # Sorting and pagination parameters
        sort: Optional[Union[Literal["last_modified"], str]] = None,
        direction: Optional[Literal[-1]] = None,
        limit: Optional[int] = None,
        # Additional data to fetch
        expand: Optional[List[ExpandDatasetProperty_T]] = None,
        full: Optional[bool] = None,
        token: Union[bool, str, None] = None,
    ) -> Iterable[DatasetInfo]:
        """
        List datasets hosted on the Huggingface Hub, given some filters.

        Args:
            filter (`str` or `Iterable[str]`, *optional*):
                A string or list of string to filter datasets on the hub.
            author (`str`, *optional*):
                A string which identify the author of the returned datasets.
            benchmark (`str` or `List`, *optional*):
                A string or list of strings that can be used to identify datasets on
                the Hub by their official benchmark.
            dataset_name (`str`, *optional*):
                A string or list of strings that can be used to identify datasets on
                the Hub by its name, such as `SQAC` or `wikineural`
            gated (`bool`, *optional*):
                A boolean to filter datasets on the Hub that are gated or not. By default, all datasets are returned.
                If `gated=True` is passed, only gated datasets are returned.
                If `gated=False` is passed, only non-gated datasets are returned.
            language_creators (`str` or `List`, *optional*):
                A string or list of strings that can be used to identify datasets on
                the Hub with how the data was curated, such as `crowdsourced` or
                `machine_generated`.
            language (`str` or `List`, *optional*):
                A string or list of strings representing a two-character language to
                filter datasets by on the Hub.
            multilinguality (`str` or `List`, *optional*):
                A string or list of strings representing a filter for datasets that
                contain multiple languages.
            size_categories (`str` or `List`, *optional*):
                A string or list of strings that can be used to identify datasets on
                the Hub by the size of the dataset such as `100K<n<1M` or
                `1M<n<10M`.
            tags (`str` or `List`, *optional*):
                A string tag or a list of tags to filter datasets on the Hub.
            task_categories (`str` or `List`, *optional*):
                A string or list of strings that can be used to identify datasets on
                the Hub by the designed task, such as `audio_classification` or
                `named_entity_recognition`.
            task_ids (`str` or `List`, *optional*):
                A string or list of strings that can be used to identify datasets on
                the Hub by the specific task such as `speech_emotion_recognition` or
                `paraphrase`.
            search (`str`, *optional*):
                A string that will be contained in the returned datasets.
            sort (`Literal["last_modified"]` or `str`, *optional*):
                The key with which to sort the resulting models. Possible values are "last_modified", "trending_score",
                "created_at", "downloads" and "likes".
            direction (`Literal[-1]` or `int`, *optional*):
                Direction in which to sort. The value `-1` sorts by descending
                order while all other values sort by ascending order.
            limit (`int`, *optional*):
                The limit on the number of datasets fetched. Leaving this option
                to `None` fetches all datasets.
            expand (`List[ExpandDatasetProperty_T]`, *optional*):
                List properties to return in the response. When used, only the properties in the list will be returned.
                This parameter cannot be used if `full` is passed.
                Possible values are `"author"`, `"cardData"`, `"citation"`, `"createdAt"`, `"disabled"`, `"description"`, `"downloads"`, `"downloadsAllTime"`, `"gated"`, `"lastModified"`, `"likes"`, `"paperswithcode_id"`, `"private"`, `"siblings"`, `"sha"`, `"tags"`, `"trendingScore"`, `"usedStorage"`, `"resourceGroup"` and `"xetEnabled"`.
            full (`bool`, *optional*):
                Whether to fetch all dataset data, including the `last_modified`,
                the `card_data` and  the files. Can contain useful information such as the
                PapersWithCode ID.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterable[DatasetInfo]`: an iterable of [`huggingface_hub.hf_api.DatasetInfo`] objects.

        Example usage with the `filter` argument:

        ```python
        >>> from huggingface_hub import HfApi

        >>> api = HfApi()

        # List all datasets
        >>> api.list_datasets()


        # List only the text classification datasets
        >>> api.list_datasets(filter="task_categories:text-classification")


        # List only the datasets in russian for language modeling
        >>> api.list_datasets(
        ...     filter=("language:ru", "task_ids:language-modeling")
        ... )

        # List FiftyOne datasets (identified by the tag "fiftyone" in dataset card)
        >>> api.list_datasets(tags="fiftyone")
        ```

        Example usage with the `search` argument:

        ```python
        >>> from huggingface_hub import HfApi

        >>> api = HfApi()

        # List all datasets with "text" in their name
        >>> api.list_datasets(search="text")

        # List all datasets with "text" in their name made by google
        >>> api.list_datasets(search="text", author="google")
        ```
        """
        if expand and full:
            raise ValueError("`expand` cannot be used if `full` is passed.")

        path = f"{self.endpoint}/api/datasets"
        headers = self._build_hf_headers(token=token)
        params: Dict[str, Any] = {}

        # Build `filter` list
        filter_list = []
        if filter is not None:
            if isinstance(filter, str):
                filter_list.append(filter)
            else:
                filter_list.extend(filter)
        for key, value in (
            ("benchmark", benchmark),
            ("language_creators", language_creators),
            ("language", language),
            ("multilinguality", multilinguality),
            ("size_categories", size_categories),
            ("task_categories", task_categories),
            ("task_ids", task_ids),
        ):
            if value:
                if isinstance(value, str):
                    value = [value]
                for value_item in value:
                    if not value_item.startswith(f"{key}:"):
                        data = f"{key}:{value_item}"
                    filter_list.append(data)
        if tags is not None:
            filter_list.extend([tags] if isinstance(tags, str) else tags)
        if len(filter_list) > 0:
            params["filter"] = filter_list

        # Handle other query params
        if author:
            params["author"] = author
        if gated is not None:
            params["gated"] = gated
        search_list = []
        if dataset_name:
            search_list.append(dataset_name)
        if search:
            search_list.append(search)
        if len(search_list) > 0:
            params["search"] = search_list
        if sort is not None:
            params["sort"] = (
                "lastModified"
                if sort == "last_modified"
                else "trendingScore"
                if sort == "trending_score"
                else "createdAt"
                if sort == "created_at"
                else sort
            )
        if direction is not None:
            params["direction"] = direction
        if limit is not None:
            params["limit"] = limit

        # Request additional data
        if expand:
            params["expand"] = expand
        if full:
            params["full"] = True

        items = paginate(path, params=params, headers=headers)
        if limit is not None:
            items = islice(items, limit)  # Do not iterate over all pages
        for item in items:
            if "siblings" not in item:
                item["siblings"] = None
            yield DatasetInfo(**item)

    @validate_hf_hub_args
    def list_spaces(
        self,
        *,
        # Search-query parameter
        filter: Union[str, Iterable[str], None] = None,
        author: Optional[str] = None,
        search: Optional[str] = None,
        datasets: Union[str, Iterable[str], None] = None,
        models: Union[str, Iterable[str], None] = None,
        linked: bool = False,
        # Sorting and pagination parameters
        sort: Union[Literal["last_modified"], str, None] = None,
        direction: Optional[Literal[-1]] = None,
        limit: Optional[int] = None,
        # Additional data to fetch
        expand: Optional[List[ExpandSpaceProperty_T]] = None,
        full: Optional[bool] = None,
        token: Union[bool, str, None] = None,
    ) -> Iterable[SpaceInfo]:
        """
        List spaces hosted on the Huggingface Hub, given some filters.

        Args:
            filter (`str` or `Iterable`, *optional*):
                A string tag or list of tags that can be used to identify Spaces on the Hub.
            author (`str`, *optional*):
                A string which identify the author of the returned Spaces.
            search (`str`, *optional*):
                A string that will be contained in the returned Spaces.
            datasets (`str` or `Iterable`, *optional*):
                Whether to return Spaces that make use of a dataset.
                The name of a specific dataset can be passed as a string.
            models (`str` or `Iterable`, *optional*):
                Whether to return Spaces that make use of a model.
                The name of a specific model can be passed as a string.
            linked (`bool`, *optional*):
                Whether to return Spaces that make use of either a model or a dataset.
            sort (`Literal["last_modified"]` or `str`, *optional*):
                The key with which to sort the resulting models. Possible values are "last_modified", "trending_score",
                "created_at" and "likes".
            direction (`Literal[-1]` or `int`, *optional*):
                Direction in which to sort. The value `-1` sorts by descending
                order while all other values sort by ascending order.
            limit (`int`, *optional*):
                The limit on the number of Spaces fetched. Leaving this option
                to `None` fetches all Spaces.
            expand (`List[ExpandSpaceProperty_T]`, *optional*):
                List properties to return in the response. When used, only the properties in the list will be returned.
                This parameter cannot be used if `full` is passed.
                Possible values are `"author"`, `"cardData"`, `"datasets"`, `"disabled"`, `"lastModified"`, `"createdAt"`, `"likes"`, `"models"`, `"private"`, `"runtime"`, `"sdk"`, `"siblings"`, `"sha"`, `"subdomain"`, `"tags"`, `"trendingScore"`, `"usedStorage"`, `"resourceGroup"` and `"xetEnabled"`.
            full (`bool`, *optional*):
                Whether to fetch all Spaces data, including the `last_modified`, `siblings`
                and `card_data` fields.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterable[SpaceInfo]`: an iterable of [`huggingface_hub.hf_api.SpaceInfo`] objects.
        """
        if expand and full:
            raise ValueError("`expand` cannot be used if `full` is passed.")

        path = f"{self.endpoint}/api/spaces"
        headers = self._build_hf_headers(token=token)
        params: Dict[str, Any] = {}
        if filter is not None:
            params["filter"] = filter
        if author is not None:
            params["author"] = author
        if search is not None:
            params["search"] = search
        if sort is not None:
            params["sort"] = (
                "lastModified"
                if sort == "last_modified"
                else "trendingScore"
                if sort == "trending_score"
                else "createdAt"
                if sort == "created_at"
                else sort
            )
        if direction is not None:
            params["direction"] = direction
        if limit is not None:
            params["limit"] = limit
        if linked:
            params["linked"] = True
        if datasets is not None:
            params["datasets"] = datasets
        if models is not None:
            params["models"] = models

        # Request additional data
        if expand:
            params["expand"] = expand
        if full:
            params["full"] = True

        items = paginate(path, params=params, headers=headers)
        if limit is not None:
            items = islice(items, limit)  # Do not iterate over all pages
        for item in items:
            if "siblings" not in item:
                item["siblings"] = None
            yield SpaceInfo(**item)

    @validate_hf_hub_args
    def unlike(
        self,
        repo_id: str,
        *,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
    ) -> None:
        """
        Unlike a given repo on the Hub (e.g. remove from favorite list).

        To prevent spam usage, it is not possible to `like` a repository from a script.

        See also [`list_liked_repos`].

        Args:
            repo_id (`str`):
                The repository to unlike. Example: `"user/my-cool-model"`.

            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if unliking a dataset or space, `None` or
                `"model"` if unliking a model. Default is `None`.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private
                but not authenticated or repo does not exist.

        Example:
        ```python
        >>> from huggingface_hub import list_liked_repos, unlike
        >>> "gpt2" in list_liked_repos().models # we assume you have already liked gpt2
        True
        >>> unlike("gpt2")
        >>> "gpt2" in list_liked_repos().models
        False
        ```
        """
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        response = get_session().delete(
            url=f"{self.endpoint}/api/{repo_type}s/{repo_id}/like", headers=self._build_hf_headers(token=token)
        )
        hf_raise_for_status(response)

    @validate_hf_hub_args
    def list_liked_repos(
        self,
        user: Optional[str] = None,
        *,
        token: Union[bool, str, None] = None,
    ) -> UserLikes:
        """
        List all public repos liked by a user on huggingface.co.

        This list is public so token is optional. If `user` is not passed, it defaults to
        the logged in user.

        See also [`unlike`].

        Args:
            user (`str`, *optional*):
                Name of the user for which you want to fetch the likes.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`UserLikes`]: object containing the user name and 3 lists of repo ids (1 for
            models, 1 for datasets and 1 for Spaces).

        Raises:
            [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
                If `user` is not passed and no token found (either from argument or from machine).

        Example:
        ```python
        >>> from huggingface_hub import list_liked_repos

        >>> likes = list_liked_repos("julien-c")

        >>> likes.user
        "julien-c"

        >>> likes.models
        ["osanseviero/streamlit_1.15", "Xhaheen/ChatGPT_HF", ...]
        ```
        """
        # User is either provided explicitly or retrieved from current token.
        if user is None:
            me = self.whoami(token=token)
            if me["type"] == "user":
                user = me["name"]
            else:
                raise ValueError(
                    "Cannot list liked repos. You must provide a 'user' as input or be logged in as a user."
                )

        path = f"{self.endpoint}/api/users/{user}/likes"
        headers = self._build_hf_headers(token=token)

        likes = list(paginate(path, params={}, headers=headers))
        # Looping over a list of items similar to:
        #   {
        #       'createdAt': '2021-09-09T21:53:27.000Z',
        #       'repo': {
        #           'name': 'PaddlePaddle/PaddleOCR',
        #           'type': 'space'
        #        }
        #   }
        # Let's loop 3 times over the received list. Less efficient but more straightforward to read.
        return UserLikes(
            user=user,
            total=len(likes),
            models=[like["repo"]["name"] for like in likes if like["repo"]["type"] == "model"],
            datasets=[like["repo"]["name"] for like in likes if like["repo"]["type"] == "dataset"],
            spaces=[like["repo"]["name"] for like in likes if like["repo"]["type"] == "space"],
        )

    @validate_hf_hub_args
    def list_repo_likers(
        self,
        repo_id: str,
        *,
        repo_type: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> Iterable[User]:
        """
        List all users who liked a given repo on the hugging Face Hub.

        See also [`list_liked_repos`].

        Args:
            repo_id (`str`):
                The repository to retrieve . Example: `"user/my-cool-model"`.

            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.

        Returns:
            `Iterable[User]`: an iterable of [`huggingface_hub.hf_api.User`] objects.
        """

        # Construct the API endpoint
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        path = f"{self.endpoint}/api/{repo_type}s/{repo_id}/likers"
        for liker in paginate(path, params={}, headers=self._build_hf_headers(token=token)):
            yield User(username=liker["user"], fullname=liker["fullname"], avatar_url=liker["avatarUrl"])

    @validate_hf_hub_args
    def model_info(
        self,
        repo_id: str,
        *,
        revision: Optional[str] = None,
        timeout: Optional[float] = None,
        securityStatus: Optional[bool] = None,
        files_metadata: bool = False,
        expand: Optional[List[ExpandModelProperty_T]] = None,
        token: Union[bool, str, None] = None,
    ) -> ModelInfo:
        """
        Get info on one specific model on huggingface.co

        Model can be private if you pass an acceptable token or are logged in.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            revision (`str`, *optional*):
                The revision of the model repository from which to get the
                information.
            timeout (`float`, *optional*):
                Whether to set a timeout for the request to the Hub.
            securityStatus (`bool`, *optional*):
                Whether to retrieve the security status from the model
                repository as well. The security status will be returned in the `security_repo_status` field.
            files_metadata (`bool`, *optional*):
                Whether or not to retrieve metadata for files in the repository
                (size, LFS metadata, etc). Defaults to `False`.
            expand (`List[ExpandModelProperty_T]`, *optional*):
                List properties to return in the response. When used, only the properties in the list will be returned.
                This parameter cannot be used if `securityStatus` or `files_metadata` are passed.
                Possible values are `"author"`, `"baseModels"`, `"cardData"`, `"childrenModelCount"`, `"config"`, `"createdAt"`, `"disabled"`, `"downloads"`, `"downloadsAllTime"`, `"gated"`, `"gguf"`, `"inference"`, `"inferenceProviderMapping"`, `"lastModified"`, `"library_name"`, `"likes"`, `"mask_token"`, `"model-index"`, `"pipeline_tag"`, `"private"`, `"safetensors"`, `"sha"`, `"siblings"`, `"spaces"`, `"tags"`, `"transformersInfo"`, `"trendingScore"`, `"widgetData"`, `"usedStorage"`, `"resourceGroup"` and `"xetEnabled"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`huggingface_hub.hf_api.ModelInfo`]: The model repository information.

        <Tip>

        Raises the following errors:

            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.
            - [`~utils.RevisionNotFoundError`]
              If the revision to download from cannot be found.

        </Tip>
        """
        if expand and (securityStatus or files_metadata):
            raise ValueError("`expand` cannot be used if `securityStatus` or `files_metadata` are set.")

        headers = self._build_hf_headers(token=token)
        path = (
            f"{self.endpoint}/api/models/{repo_id}"
            if revision is None
            else (f"{self.endpoint}/api/models/{repo_id}/revision/{quote(revision, safe='')}")
        )
        params: Dict = {}
        if securityStatus:
            params["securityStatus"] = True
        if files_metadata:
            params["blobs"] = True
        if expand:
            params["expand"] = expand
        r = get_session().get(path, headers=headers, timeout=timeout, params=params)
        hf_raise_for_status(r)
        data = r.json()
        return ModelInfo(**data)

    @validate_hf_hub_args
    def dataset_info(
        self,
        repo_id: str,
        *,
        revision: Optional[str] = None,
        timeout: Optional[float] = None,
        files_metadata: bool = False,
        expand: Optional[List[ExpandDatasetProperty_T]] = None,
        token: Union[bool, str, None] = None,
    ) -> DatasetInfo:
        """
        Get info on one specific dataset on huggingface.co.

        Dataset can be private if you pass an acceptable token.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            revision (`str`, *optional*):
                The revision of the dataset repository from which to get the
                information.
            timeout (`float`, *optional*):
                Whether to set a timeout for the request to the Hub.
            files_metadata (`bool`, *optional*):
                Whether or not to retrieve metadata for files in the repository
                (size, LFS metadata, etc). Defaults to `False`.
            expand (`List[ExpandDatasetProperty_T]`, *optional*):
                List properties to return in the response. When used, only the properties in the list will be returned.
                This parameter cannot be used if `files_metadata` is passed.
                Possible values are `"author"`, `"cardData"`, `"citation"`, `"createdAt"`, `"disabled"`, `"description"`, `"downloads"`, `"downloadsAllTime"`, `"gated"`, `"lastModified"`, `"likes"`, `"paperswithcode_id"`, `"private"`, `"siblings"`, `"sha"`, `"tags"`, `"trendingScore"`,`"usedStorage"`, `"resourceGroup"` and `"xetEnabled"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`hf_api.DatasetInfo`]: The dataset repository information.

        <Tip>

        Raises the following errors:

            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.
            - [`~utils.RevisionNotFoundError`]
              If the revision to download from cannot be found.

        </Tip>
        """
        if expand and files_metadata:
            raise ValueError("`expand` cannot be used if `files_metadata` is set.")

        headers = self._build_hf_headers(token=token)
        path = (
            f"{self.endpoint}/api/datasets/{repo_id}"
            if revision is None
            else (f"{self.endpoint}/api/datasets/{repo_id}/revision/{quote(revision, safe='')}")
        )
        params: Dict = {}
        if files_metadata:
            params["blobs"] = True
        if expand:
            params["expand"] = expand

        r = get_session().get(path, headers=headers, timeout=timeout, params=params)
        hf_raise_for_status(r)
        data = r.json()
        return DatasetInfo(**data)

    @validate_hf_hub_args
    def space_info(
        self,
        repo_id: str,
        *,
        revision: Optional[str] = None,
        timeout: Optional[float] = None,
        files_metadata: bool = False,
        expand: Optional[List[ExpandSpaceProperty_T]] = None,
        token: Union[bool, str, None] = None,
    ) -> SpaceInfo:
        """
        Get info on one specific Space on huggingface.co.

        Space can be private if you pass an acceptable token.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            revision (`str`, *optional*):
                The revision of the space repository from which to get the
                information.
            timeout (`float`, *optional*):
                Whether to set a timeout for the request to the Hub.
            files_metadata (`bool`, *optional*):
                Whether or not to retrieve metadata for files in the repository
                (size, LFS metadata, etc). Defaults to `False`.
            expand (`List[ExpandSpaceProperty_T]`, *optional*):
                List properties to return in the response. When used, only the properties in the list will be returned.
                This parameter cannot be used if `full` is passed.
                Possible values are `"author"`, `"cardData"`, `"createdAt"`, `"datasets"`, `"disabled"`, `"lastModified"`, `"likes"`, `"models"`, `"private"`, `"runtime"`, `"sdk"`, `"siblings"`, `"sha"`, `"subdomain"`, `"tags"`, `"trendingScore"`, `"usedStorage"`, `"resourceGroup"` and `"xetEnabled"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`~hf_api.SpaceInfo`]: The space repository information.

        <Tip>

        Raises the following errors:

            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.
            - [`~utils.RevisionNotFoundError`]
              If the revision to download from cannot be found.

        </Tip>
        """
        if expand and files_metadata:
            raise ValueError("`expand` cannot be used if `files_metadata` is set.")

        headers = self._build_hf_headers(token=token)
        path = (
            f"{self.endpoint}/api/spaces/{repo_id}"
            if revision is None
            else (f"{self.endpoint}/api/spaces/{repo_id}/revision/{quote(revision, safe='')}")
        )
        params: Dict = {}
        if files_metadata:
            params["blobs"] = True
        if expand:
            params["expand"] = expand

        r = get_session().get(path, headers=headers, timeout=timeout, params=params)
        hf_raise_for_status(r)
        data = r.json()
        return SpaceInfo(**data)

    @validate_hf_hub_args
    def repo_info(
        self,
        repo_id: str,
        *,
        revision: Optional[str] = None,
        repo_type: Optional[str] = None,
        timeout: Optional[float] = None,
        files_metadata: bool = False,
        expand: Optional[Union[ExpandModelProperty_T, ExpandDatasetProperty_T, ExpandSpaceProperty_T]] = None,
        token: Union[bool, str, None] = None,
    ) -> Union[ModelInfo, DatasetInfo, SpaceInfo]:
        """
        Get the info object for a given repo of a given type.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            revision (`str`, *optional*):
                The revision of the repository from which to get the
                information.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if getting repository info from a dataset or a space,
                `None` or `"model"` if getting repository info from a model. Default is `None`.
            timeout (`float`, *optional*):
                Whether to set a timeout for the request to the Hub.
            expand (`ExpandModelProperty_T` or `ExpandDatasetProperty_T` or `ExpandSpaceProperty_T`, *optional*):
                List properties to return in the response. When used, only the properties in the list will be returned.
                This parameter cannot be used if `files_metadata` is passed.
                For an exhaustive list of available properties, check out [`model_info`], [`dataset_info`] or [`space_info`].
            files_metadata (`bool`, *optional*):
                Whether or not to retrieve metadata for files in the repository
                (size, LFS metadata, etc). Defaults to `False`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Union[SpaceInfo, DatasetInfo, ModelInfo]`: The repository information, as a
            [`huggingface_hub.hf_api.DatasetInfo`], [`huggingface_hub.hf_api.ModelInfo`]
            or [`huggingface_hub.hf_api.SpaceInfo`] object.

        <Tip>

        Raises the following errors:

            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.
            - [`~utils.RevisionNotFoundError`]
              If the revision to download from cannot be found.

        </Tip>
        """
        if repo_type is None or repo_type == "model":
            method = self.model_info
        elif repo_type == "dataset":
            method = self.dataset_info  # type: ignore
        elif repo_type == "space":
            method = self.space_info  # type: ignore
        else:
            raise ValueError("Unsupported repo type.")
        return method(
            repo_id,
            revision=revision,
            token=token,
            timeout=timeout,
            expand=expand,  # type: ignore[arg-type]
            files_metadata=files_metadata,
        )

    @validate_hf_hub_args
    def repo_exists(
        self,
        repo_id: str,
        *,
        repo_type: Optional[str] = None,
        token: Union[str, bool, None] = None,
    ) -> bool:
        """
        Checks if a repository exists on the Hugging Face Hub.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if getting repository info from a dataset or a space,
                `None` or `"model"` if getting repository info from a model. Default is `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            True if the repository exists, False otherwise.

        Examples:
            ```py
            >>> from huggingface_hub import repo_exists
            >>> repo_exists("google/gemma-7b")
            True
            >>> repo_exists("google/not-a-repo")
            False
            ```
        """
        try:
            self.repo_info(repo_id=repo_id, repo_type=repo_type, token=token)
            return True
        except GatedRepoError:
            return True  # we don't have access but it exists
        except RepositoryNotFoundError:
            return False

    @validate_hf_hub_args
    def revision_exists(
        self,
        repo_id: str,
        revision: str,
        *,
        repo_type: Optional[str] = None,
        token: Union[str, bool, None] = None,
    ) -> bool:
        """
        Checks if a specific revision exists on a repo on the Hugging Face Hub.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            revision (`str`):
                The revision of the repository to check.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if getting repository info from a dataset or a space,
                `None` or `"model"` if getting repository info from a model. Default is `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            True if the repository and the revision exists, False otherwise.

        Examples:
            ```py
            >>> from huggingface_hub import revision_exists
            >>> revision_exists("google/gemma-7b", "float16")
            True
            >>> revision_exists("google/gemma-7b", "not-a-revision")
            False
            ```
        """
        try:
            self.repo_info(repo_id=repo_id, revision=revision, repo_type=repo_type, token=token)
            return True
        except RevisionNotFoundError:
            return False
        except RepositoryNotFoundError:
            return False

    @validate_hf_hub_args
    def file_exists(
        self,
        repo_id: str,
        filename: str,
        *,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        token: Union[str, bool, None] = None,
    ) -> bool:
        """
        Checks if a file exists in a repository on the Hugging Face Hub.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            filename (`str`):
                The name of the file to check, for example:
                `"config.json"`
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if getting repository info from a dataset or a space,
                `None` or `"model"` if getting repository info from a model. Default is `None`.
            revision (`str`, *optional*):
                The revision of the repository from which to get the information. Defaults to `"main"` branch.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            True if the file exists, False otherwise.

        Examples:
            ```py
            >>> from huggingface_hub import file_exists
            >>> file_exists("bigcode/starcoder", "config.json")
            True
            >>> file_exists("bigcode/starcoder", "not-a-file")
            False
            >>> file_exists("bigcode/not-a-repo", "config.json")
            False
            ```
        """
        url = hf_hub_url(
            repo_id=repo_id, repo_type=repo_type, revision=revision, filename=filename, endpoint=self.endpoint
        )
        try:
            if token is None:
                token = self.token
            get_hf_file_metadata(url, token=token)
            return True
        except GatedRepoError:  # raise specifically on gated repo
            raise
        except (RepositoryNotFoundError, EntryNotFoundError, RevisionNotFoundError):
            return False

    @validate_hf_hub_args
    def list_repo_files(
        self,
        repo_id: str,
        *,
        revision: Optional[str] = None,
        repo_type: Optional[str] = None,
        token: Union[str, bool, None] = None,
    ) -> List[str]:
        """
        Get the list of files in a given repo.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated by a `/`.
            revision (`str`, *optional*):
                The revision of the repository from which to get the information.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or space, `None` or `"model"` if uploading to
                a model. Default is `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `List[str]`: the list of files in a given repository.
        """
        return [
            f.rfilename
            for f in self.list_repo_tree(
                repo_id=repo_id, recursive=True, revision=revision, repo_type=repo_type, token=token
            )
            if isinstance(f, RepoFile)
        ]

    @validate_hf_hub_args
    def list_repo_tree(
        self,
        repo_id: str,
        path_in_repo: Optional[str] = None,
        *,
        recursive: bool = False,
        expand: bool = False,
        revision: Optional[str] = None,
        repo_type: Optional[str] = None,
        token: Union[str, bool, None] = None,
    ) -> Iterable[Union[RepoFile, RepoFolder]]:
        """
        List a repo tree's files and folders and get information about them.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated by a `/`.
            path_in_repo (`str`, *optional*):
                Relative path of the tree (folder) in the repo, for example:
                `"checkpoints/1fec34a/results"`. Will default to the root tree (folder) of the repository.
            recursive (`bool`, *optional*, defaults to `False`):
                Whether to list tree's files and folders recursively.
            expand (`bool`, *optional*, defaults to `False`):
                Whether to fetch more information about the tree's files and folders (e.g. last commit and files' security scan results). This
                operation is more expensive for the server so only 50 results are returned per page (instead of 1000).
                As pagination is implemented in `huggingface_hub`, this is transparent for you except for the time it
                takes to get the results.
            revision (`str`, *optional*):
                The revision of the repository from which to get the tree. Defaults to `"main"` branch.
            repo_type (`str`, *optional*):
                The type of the repository from which to get the tree (`"model"`, `"dataset"` or `"space"`.
                Defaults to `"model"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterable[Union[RepoFile, RepoFolder]]`:
                The information about the tree's files and folders, as an iterable of [`RepoFile`] and [`RepoFolder`] objects. The order of the files and folders is
                not guaranteed.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private but not authenticated or repo
                does not exist.
            [`~utils.RevisionNotFoundError`]:
                If revision is not found (error 404) on the repo.
            [`~utils.EntryNotFoundError`]:
                If the tree (folder) does not exist (error 404) on the repo.

        Examples:

            Get information about a repo's tree.
            ```py
            >>> from huggingface_hub import list_repo_tree
            >>> repo_tree = list_repo_tree("lysandre/arxiv-nlp")
            >>> repo_tree
            <generator object HfApi.list_repo_tree at 0x7fa4088e1ac0>
            >>> list(repo_tree)
            [
                RepoFile(path='.gitattributes', size=391, blob_id='ae8c63daedbd4206d7d40126955d4e6ab1c80f8f', lfs=None, last_commit=None, security=None),
                RepoFile(path='README.md', size=391, blob_id='43bd404b159de6fba7c2f4d3264347668d43af25', lfs=None, last_commit=None, security=None),
                RepoFile(path='config.json', size=554, blob_id='2f9618c3a19b9a61add74f70bfb121335aeef666', lfs=None, last_commit=None, security=None),
                RepoFile(
                    path='flax_model.msgpack', size=497764107, blob_id='8095a62ccb4d806da7666fcda07467e2d150218e',
                    lfs={'size': 497764107, 'sha256': 'd88b0d6a6ff9c3f8151f9d3228f57092aaea997f09af009eefd7373a77b5abb9', 'pointer_size': 134}, last_commit=None, security=None
                ),
                RepoFile(path='merges.txt', size=456318, blob_id='226b0752cac7789c48f0cb3ec53eda48b7be36cc', lfs=None, last_commit=None, security=None),
                RepoFile(
                    path='pytorch_model.bin', size=548123560, blob_id='64eaa9c526867e404b68f2c5d66fd78e27026523',
                    lfs={'size': 548123560, 'sha256': '9be78edb5b928eba33aa88f431551348f7466ba9f5ef3daf1d552398722a5436', 'pointer_size': 134}, last_commit=None, security=None
                ),
                RepoFile(path='vocab.json', size=898669, blob_id='b00361fece0387ca34b4b8b8539ed830d644dbeb', lfs=None, last_commit=None, security=None)]
            ]
            ```

            Get even more information about a repo's tree (last commit and files' security scan results)
            ```py
            >>> from huggingface_hub import list_repo_tree
            >>> repo_tree = list_repo_tree("prompthero/openjourney-v4", expand=True)
            >>> list(repo_tree)
            [
                RepoFolder(
                    path='feature_extractor',
                    tree_id='aa536c4ea18073388b5b0bc791057a7296a00398',
                    last_commit={
                        'oid': '47b62b20b20e06b9de610e840282b7e6c3d51190',
                        'title': 'Upload diffusers weights (#48)',
                        'date': datetime.datetime(2023, 3, 21, 9, 5, 27, tzinfo=datetime.timezone.utc)
                    }
                ),
                RepoFolder(
                    path='safety_checker',
                    tree_id='65aef9d787e5557373fdf714d6c34d4fcdd70440',
                    last_commit={
                        'oid': '47b62b20b20e06b9de610e840282b7e6c3d51190',
                        'title': 'Upload diffusers weights (#48)',
                        'date': datetime.datetime(2023, 3, 21, 9, 5, 27, tzinfo=datetime.timezone.utc)
                    }
                ),
                RepoFile(
                    path='model_index.json',
                    size=582,
                    blob_id='d3d7c1e8c3e78eeb1640b8e2041ee256e24c9ee1',
                    lfs=None,
                    last_commit={
                        'oid': 'b195ed2d503f3eb29637050a886d77bd81d35f0e',
                        'title': 'Fix deprecation warning by changing `CLIPFeatureExtractor` to `CLIPImageProcessor`. (#54)',
                        'date': datetime.datetime(2023, 5, 15, 21, 41, 59, tzinfo=datetime.timezone.utc)
                    },
                    security={
                        'safe': True,
                        'av_scan': {'virusFound': False, 'virusNames': None},
                        'pickle_import_scan': None
                    }
                )
                ...
            ]
            ```
        """
        repo_type = repo_type or constants.REPO_TYPE_MODEL
        revision = quote(revision, safe="") if revision is not None else constants.DEFAULT_REVISION
        headers = self._build_hf_headers(token=token)

        encoded_path_in_repo = "/" + quote(path_in_repo, safe="") if path_in_repo else ""
        tree_url = f"{self.endpoint}/api/{repo_type}s/{repo_id}/tree/{revision}{encoded_path_in_repo}"
        for path_info in paginate(path=tree_url, headers=headers, params={"recursive": recursive, "expand": expand}):
            yield (RepoFile(**path_info) if path_info["type"] == "file" else RepoFolder(**path_info))

    @validate_hf_hub_args
    def list_repo_refs(
        self,
        repo_id: str,
        *,
        repo_type: Optional[str] = None,
        include_pull_requests: bool = False,
        token: Union[str, bool, None] = None,
    ) -> GitRefs:
        """
        Get the list of refs of a given repo (both tags and branches).

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if listing refs from a dataset or a Space,
                `None` or `"model"` if listing from a model. Default is `None`.
            include_pull_requests (`bool`, *optional*):
                Whether to include refs from pull requests in the list. Defaults to `False`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Example:
        ```py
        >>> from huggingface_hub import HfApi
        >>> api = HfApi()
        >>> api.list_repo_refs("gpt2")
        GitRefs(branches=[GitRefInfo(name='main', ref='refs/heads/main', target_commit='e7da7f221d5bf496a48136c0cd264e630fe9fcc8')], converts=[], tags=[])

        >>> api.list_repo_refs("bigcode/the-stack", repo_type='dataset')
        GitRefs(
            branches=[
                GitRefInfo(name='main', ref='refs/heads/main', target_commit='18edc1591d9ce72aa82f56c4431b3c969b210ae3'),
                GitRefInfo(name='v1.1.a1', ref='refs/heads/v1.1.a1', target_commit='f9826b862d1567f3822d3d25649b0d6d22ace714')
            ],
            converts=[],
            tags=[
                GitRefInfo(name='v1.0', ref='refs/tags/v1.0', target_commit='c37a8cd1e382064d8aced5e05543c5f7753834da')
            ]
        )
        ```

        Returns:
            [`GitRefs`]: object containing all information about branches and tags for a
            repo on the Hub.
        """
        repo_type = repo_type or constants.REPO_TYPE_MODEL
        response = get_session().get(
            f"{self.endpoint}/api/{repo_type}s/{repo_id}/refs",
            headers=self._build_hf_headers(token=token),
            params={"include_prs": 1} if include_pull_requests else {},
        )
        hf_raise_for_status(response)
        data = response.json()

        def _format_as_git_ref_info(item: Dict) -> GitRefInfo:
            return GitRefInfo(name=item["name"], ref=item["ref"], target_commit=item["targetCommit"])

        return GitRefs(
            branches=[_format_as_git_ref_info(item) for item in data["branches"]],
            converts=[_format_as_git_ref_info(item) for item in data["converts"]],
            tags=[_format_as_git_ref_info(item) for item in data["tags"]],
            pull_requests=[_format_as_git_ref_info(item) for item in data["pullRequests"]]
            if include_pull_requests
            else None,
        )

    @validate_hf_hub_args
    def list_repo_commits(
        self,
        repo_id: str,
        *,
        repo_type: Optional[str] = None,
        token: Union[bool, str, None] = None,
        revision: Optional[str] = None,
        formatted: bool = False,
    ) -> List[GitCommitInfo]:
        """
        Get the list of commits of a given revision for a repo on the Hub.

        Commits are sorted by date (last commit first).

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated by a `/`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if listing commits from a dataset or a Space, `None` or `"model"` if
                listing from a model. Default is `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            revision (`str`, *optional*):
                The git revision to commit from. Defaults to the head of the `"main"` branch.
            formatted (`bool`):
                Whether to return the HTML-formatted title and description of the commits. Defaults to False.

        Example:
        ```py
        >>> from huggingface_hub import HfApi
        >>> api = HfApi()

        # Commits are sorted by date (last commit first)
        >>> initial_commit = api.list_repo_commits("gpt2")[-1]

        # Initial commit is always a system commit containing the `.gitattributes` file.
        >>> initial_commit
        GitCommitInfo(
            commit_id='9b865efde13a30c13e0a33e536cf3e4a5a9d71d8',
            authors=['system'],
            created_at=datetime.datetime(2019, 2, 18, 10, 36, 15, tzinfo=datetime.timezone.utc),
            title='initial commit',
            message='',
            formatted_title=None,
            formatted_message=None
        )

        # Create an empty branch by deriving from initial commit
        >>> api.create_branch("gpt2", "new_empty_branch", revision=initial_commit.commit_id)
        ```

        Returns:
            List[[`GitCommitInfo`]]: list of objects containing information about the commits for a repo on the Hub.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private but not authenticated or repo
                does not exist.
            [`~utils.RevisionNotFoundError`]:
                If revision is not found (error 404) on the repo.
        """
        repo_type = repo_type or constants.REPO_TYPE_MODEL
        revision = quote(revision, safe="") if revision is not None else constants.DEFAULT_REVISION

        # Paginate over results and return the list of commits.
        return [
            GitCommitInfo(
                commit_id=item["id"],
                authors=[author["user"] for author in item["authors"]],
                created_at=parse_datetime(item["date"]),
                title=item["title"],
                message=item["message"],
                formatted_title=item.get("formatted", {}).get("title"),
                formatted_message=item.get("formatted", {}).get("message"),
            )
            for item in paginate(
                f"{self.endpoint}/api/{repo_type}s/{repo_id}/commits/{revision}",
                headers=self._build_hf_headers(token=token),
                params={"expand[]": "formatted"} if formatted else {},
            )
        ]

    @validate_hf_hub_args
    def get_paths_info(
        self,
        repo_id: str,
        paths: Union[List[str], str],
        *,
        expand: bool = False,
        revision: Optional[str] = None,
        repo_type: Optional[str] = None,
        token: Union[str, bool, None] = None,
    ) -> List[Union[RepoFile, RepoFolder]]:
        """
        Get information about a repo's paths.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated by a `/`.
            paths (`Union[List[str], str]`, *optional*):
                The paths to get information about. If a path do not exist, it is ignored without raising
                an exception.
            expand (`bool`, *optional*, defaults to `False`):
                Whether to fetch more information about the paths (e.g. last commit and files' security scan results). This
                operation is more expensive for the server so only 50 results are returned per page (instead of 1000).
                As pagination is implemented in `huggingface_hub`, this is transparent for you except for the time it
                takes to get the results.
            revision (`str`, *optional*):
                The revision of the repository from which to get the information. Defaults to `"main"` branch.
            repo_type (`str`, *optional*):
                The type of the repository from which to get the information (`"model"`, `"dataset"` or `"space"`.
                Defaults to `"model"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `List[Union[RepoFile, RepoFolder]]`:
                The information about the paths, as a list of [`RepoFile`] and [`RepoFolder`] objects.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private but not authenticated or repo
                does not exist.
            [`~utils.RevisionNotFoundError`]:
                If revision is not found (error 404) on the repo.

        Example:
        ```py
        >>> from huggingface_hub import get_paths_info
        >>> paths_info = get_paths_info("allenai/c4", ["README.md", "en"], repo_type="dataset")
        >>> paths_info
        [
            RepoFile(path='README.md', size=2379, blob_id='f84cb4c97182890fc1dbdeaf1a6a468fd27b4fff', lfs=None, last_commit=None, security=None),
            RepoFolder(path='en', tree_id='dc943c4c40f53d02b31ced1defa7e5f438d5862e', last_commit=None)
        ]
        ```
        """
        repo_type = repo_type or constants.REPO_TYPE_MODEL
        revision = quote(revision, safe="") if revision is not None else constants.DEFAULT_REVISION
        headers = self._build_hf_headers(token=token)

        response = get_session().post(
            f"{self.endpoint}/api/{repo_type}s/{repo_id}/paths-info/{revision}",
            data={
                "paths": paths if isinstance(paths, list) else [paths],
                "expand": expand,
            },
            headers=headers,
        )
        hf_raise_for_status(response)
        paths_info = response.json()
        return [
            RepoFile(**path_info) if path_info["type"] == "file" else RepoFolder(**path_info)
            for path_info in paths_info
        ]

    @validate_hf_hub_args
    def super_squash_history(
        self,
        repo_id: str,
        *,
        branch: Optional[str] = None,
        commit_message: Optional[str] = None,
        repo_type: Optional[str] = None,
        token: Union[str, bool, None] = None,
    ) -> None:
        """Squash commit history on a branch for a repo on the Hub.

        Squashing the repo history is useful when you know you'll make hundreds of commits and you don't want to
        clutter the history. Squashing commits can only be performed from the head of a branch.

        <Tip warning={true}>

        Once squashed, the commit history cannot be retrieved. This is a non-revertible operation.

        </Tip>

        <Tip warning={true}>

        Once the history of a branch has been squashed, it is not possible to merge it back into another branch since
        their history will have diverged.

        </Tip>

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated by a `/`.
            branch (`str`, *optional*):
                The branch to squash. Defaults to the head of the `"main"` branch.
            commit_message (`str`, *optional*):
                The commit message to use for the squashed commit.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if listing commits from a dataset or a Space, `None` or `"model"` if
                listing from a model. Default is `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private but not authenticated or repo
                does not exist.
            [`~utils.RevisionNotFoundError`]:
                If the branch to squash cannot be found.
            [`~utils.BadRequestError`]:
                If invalid reference for a branch. You cannot squash history on tags.

        Example:
        ```py
        >>> from huggingface_hub import HfApi
        >>> api = HfApi()

        # Create repo
        >>> repo_id = api.create_repo("test-squash").repo_id

        # Make a lot of commits.
        >>> api.upload_file(repo_id=repo_id, path_in_repo="file.txt", path_or_fileobj=b"content")
        >>> api.upload_file(repo_id=repo_id, path_in_repo="lfs.bin", path_or_fileobj=b"content")
        >>> api.upload_file(repo_id=repo_id, path_in_repo="file.txt", path_or_fileobj=b"another_content")

        # Squash history
        >>> api.super_squash_history(repo_id=repo_id)
        ```
        """
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        if repo_type not in constants.REPO_TYPES:
            raise ValueError("Invalid repo type")
        if branch is None:
            branch = constants.DEFAULT_REVISION

        # Prepare request
        url = f"{self.endpoint}/api/{repo_type}s/{repo_id}/super-squash/{quote(branch, safe='')}"
        headers = self._build_hf_headers(token=token)
        commit_message = commit_message or f"Super-squash branch '{branch}' using huggingface_hub"

        # Super-squash
        response = get_session().post(url=url, headers=headers, json={"message": commit_message})
        hf_raise_for_status(response)

    @validate_hf_hub_args
    def list_lfs_files(
        self,
        repo_id: str,
        *,
        repo_type: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> Iterable[LFSFileInfo]:
        """
        List all LFS files in a repo on the Hub.

        This is primarily useful to count how much storage a repo is using and to eventually clean up large files
        with [`permanently_delete_lfs_files`]. Note that this would be a permanent action that will affect all commits
        referencing this deleted files and that cannot be undone.

        Args:
            repo_id (`str`):
                The repository for which you are listing LFS files.
            repo_type (`str`, *optional*):
                Type of repository. Set to `"dataset"` or `"space"` if listing from a dataset or space, `None` or
                `"model"` if listing from a model. Default is `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterable[LFSFileInfo]`: An iterator of [`LFSFileInfo`] objects.

        Example:
            ```py
            >>> from huggingface_hub import HfApi
            >>> api = HfApi()
            >>> lfs_files = api.list_lfs_files("username/my-cool-repo")

            # Filter files files to delete based on a combination of `filename`, `pushed_at`, `ref` or `size`.
            # e.g. select only LFS files in the "checkpoints" folder
            >>> lfs_files_to_delete = (lfs_file for lfs_file in lfs_files if lfs_file.filename.startswith("checkpoints/"))

            # Permanently delete LFS files
            >>> api.permanently_delete_lfs_files("username/my-cool-repo", lfs_files_to_delete)
            ```
        """
        # Prepare request
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        url = f"{self.endpoint}/api/{repo_type}s/{repo_id}/lfs-files"
        headers = self._build_hf_headers(token=token)

        # Paginate over LFS items
        for item in paginate(url, params={}, headers=headers):
            yield LFSFileInfo(**item)

    @validate_hf_hub_args
    def permanently_delete_lfs_files(
        self,
        repo_id: str,
        lfs_files: Iterable[LFSFileInfo],
        *,
        rewrite_history: bool = True,
        repo_type: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> None:
        """
        Permanently delete LFS files from a repo on the Hub.

        <Tip warning={true}>

        This is a permanent action that will affect all commits referencing the deleted files and might corrupt your
        repository. This is a non-revertible operation. Use it only if you know what you are doing.

        </Tip>

        Args:
            repo_id (`str`):
                The repository for which you are listing LFS files.
            lfs_files (`Iterable[LFSFileInfo]`):
                An iterable of [`LFSFileInfo`] items to permanently delete from the repo. Use [`list_lfs_files`] to list
                all LFS files from a repo.
            rewrite_history (`bool`, *optional*, default to `True`):
                Whether to rewrite repository history to remove file pointers referencing the deleted LFS files (recommended).
            repo_type (`str`, *optional*):
                Type of repository. Set to `"dataset"` or `"space"` if listing from a dataset or space, `None` or
                `"model"` if listing from a model. Default is `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Example:
            ```py
            >>> from huggingface_hub import HfApi
            >>> api = HfApi()
            >>> lfs_files = api.list_lfs_files("username/my-cool-repo")

            # Filter files files to delete based on a combination of `filename`, `pushed_at`, `ref` or `size`.
            # e.g. select only LFS files in the "checkpoints" folder
            >>> lfs_files_to_delete = (lfs_file for lfs_file in lfs_files if lfs_file.filename.startswith("checkpoints/"))

            # Permanently delete LFS files
            >>> api.permanently_delete_lfs_files("username/my-cool-repo", lfs_files_to_delete)
            ```
        """
        # Prepare request
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        url = f"{self.endpoint}/api/{repo_type}s/{repo_id}/lfs-files/batch"
        headers = self._build_hf_headers(token=token)

        # Delete LFS items by batches of 1000
        for batch in chunk_iterable(lfs_files, 1000):
            shas = [item.file_oid for item in batch]
            if len(shas) == 0:
                return
            payload = {
                "deletions": {
                    "sha": shas,
                    "rewriteHistory": rewrite_history,
                }
            }
            response = get_session().post(url, headers=headers, json=payload)
            hf_raise_for_status(response)

    @validate_hf_hub_args
    def create_repo(
        self,
        repo_id: str,
        *,
        token: Union[str, bool, None] = None,
        private: Optional[bool] = None,
        repo_type: Optional[str] = None,
        exist_ok: bool = False,
        resource_group_id: Optional[str] = None,
        space_sdk: Optional[str] = None,
        space_hardware: Optional[SpaceHardware] = None,
        space_storage: Optional[SpaceStorage] = None,
        space_sleep_time: Optional[int] = None,
        space_secrets: Optional[List[Dict[str, str]]] = None,
        space_variables: Optional[List[Dict[str, str]]] = None,
    ) -> RepoUrl:
        """Create an empty repo on the HuggingFace Hub.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            private (`bool`, *optional*):
                Whether to make the repo private. If `None` (default), the repo will be public unless the organization's default is private. This value is ignored if the repo already exists.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            exist_ok (`bool`, *optional*, defaults to `False`):
                If `True`, do not raise an error if repo already exists.
            resource_group_id (`str`, *optional*):
                Resource group in which to create the repo. Resource groups is only available for Enterprise Hub organizations and
                allow to define which members of the organization can access the resource. The ID of a resource group
                can be found in the URL of the resource's page on the Hub (e.g. `"66670e5163145ca562cb1988"`).
                To learn more about resource groups, see https://huggingface.co/docs/hub/en/security-resource-groups.
            space_sdk (`str`, *optional*):
                Choice of SDK to use if repo_type is "space". Can be "streamlit", "gradio", "docker", or "static".
            space_hardware (`SpaceHardware` or `str`, *optional*):
                Choice of Hardware if repo_type is "space". See [`SpaceHardware`] for a complete list.
            space_storage (`SpaceStorage` or `str`, *optional*):
                Choice of persistent storage tier. Example: `"small"`. See [`SpaceStorage`] for a complete list.
            space_sleep_time (`int`, *optional*):
                Number of seconds of inactivity to wait before a Space is put to sleep. Set to `-1` if you don't want
                your Space to sleep (default behavior for upgraded hardware). For free hardware, you can't configure
                the sleep time (value is fixed to 48 hours of inactivity).
                See https://huggingface.co/docs/hub/spaces-gpus#sleep-time for more details.
            space_secrets (`List[Dict[str, str]]`, *optional*):
                A list of secret keys to set in your Space. Each item is in the form `{"key": ..., "value": ..., "description": ...}` where description is optional.
                For more details, see https://huggingface.co/docs/hub/spaces-overview#managing-secrets.
            space_variables (`List[Dict[str, str]]`, *optional*):
                A list of public environment variables to set in your Space. Each item is in the form `{"key": ..., "value": ..., "description": ...}` where description is optional.
                For more details, see https://huggingface.co/docs/hub/spaces-overview#managing-secrets-and-environment-variables.

        Returns:
            [`RepoUrl`]: URL to the newly created repo. Value is a subclass of `str` containing
            attributes like `endpoint`, `repo_type` and `repo_id`.
        """
        organization, name = repo_id.split("/") if "/" in repo_id else (None, repo_id)

        path = f"{self.endpoint}/api/repos/create"

        if repo_type not in constants.REPO_TYPES:
            raise ValueError("Invalid repo type")

        json: Dict[str, Any] = {"name": name, "organization": organization}
        if private is not None:
            json["private"] = private
        if repo_type is not None:
            json["type"] = repo_type
        if repo_type == "space":
            if space_sdk is None:
                raise ValueError(
                    "No space_sdk provided. `create_repo` expects space_sdk to be one"
                    f" of {constants.SPACES_SDK_TYPES} when repo_type is 'space'`"
                )
            if space_sdk not in constants.SPACES_SDK_TYPES:
                raise ValueError(f"Invalid space_sdk. Please choose one of {constants.SPACES_SDK_TYPES}.")
            json["sdk"] = space_sdk

        if space_sdk is not None and repo_type != "space":
            warnings.warn("Ignoring provided space_sdk because repo_type is not 'space'.")

        function_args = [
            "space_hardware",
            "space_storage",
            "space_sleep_time",
            "space_secrets",
            "space_variables",
        ]
        json_keys = ["hardware", "storageTier", "sleepTimeSeconds", "secrets", "variables"]
        values = [space_hardware, space_storage, space_sleep_time, space_secrets, space_variables]

        if repo_type == "space":
            json.update({k: v for k, v in zip(json_keys, values) if v is not None})
        else:
            provided_space_args = [key for key, value in zip(function_args, values) if value is not None]

            if provided_space_args:
                warnings.warn(f"Ignoring provided {', '.join(provided_space_args)} because repo_type is not 'space'.")

        if getattr(self, "_lfsmultipartthresh", None):
            # Testing purposes only.
            # See https://github.com/huggingface/huggingface_hub/pull/733/files#r820604472
            json["lfsmultipartthresh"] = self._lfsmultipartthresh  # type: ignore

        if resource_group_id is not None:
            json["resourceGroupId"] = resource_group_id

        headers = self._build_hf_headers(token=token)
        while True:
            r = get_session().post(path, headers=headers, json=json)
            if r.status_code == 409 and "Cannot create repo: another conflicting operation is in progress" in r.text:
                # Since https://github.com/huggingface/moon-landing/pull/7272 (private repo), it is not possible to
                # concurrently create repos on the Hub for a same user. This is rarely an issue, except when running
                # tests. To avoid any inconvenience, we retry to create the repo for this specific error.
                # NOTE: This could have being fixed directly in the tests but adding it here should fixed CIs for all
                # dependent libraries.
                # NOTE: If a fix is implemented server-side, we should be able to remove this retry mechanism.
                logger.debug("Create repo failed due to a concurrency issue. Retrying...")
                continue
            break

        try:
            hf_raise_for_status(r)
        except HTTPError as err:
            if exist_ok and err.response.status_code == 409:
                # Repo already exists and `exist_ok=True`
                pass
            elif exist_ok and err.response.status_code == 403:
                # No write permission on the namespace but repo might already exist
                try:
                    self.repo_info(repo_id=repo_id, repo_type=repo_type, token=token)
                    if repo_type is None or repo_type == constants.REPO_TYPE_MODEL:
                        return RepoUrl(f"{self.endpoint}/{repo_id}")
                    return RepoUrl(f"{self.endpoint}/{repo_type}/{repo_id}")
                except HfHubHTTPError:
                    raise err
            else:
                raise

        d = r.json()
        return RepoUrl(d["url"], endpoint=self.endpoint)

    @validate_hf_hub_args
    def delete_repo(
        self,
        repo_id: str,
        *,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        missing_ok: bool = False,
    ) -> None:
        """
        Delete a repo from the HuggingFace Hub. CAUTION: this is irreversible.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model.
            missing_ok (`bool`, *optional*, defaults to `False`):
                If `True`, do not raise an error if repo does not exist.

        Raises:
            [`~utils.RepositoryNotFoundError`]
              If the repository to delete from cannot be found and `missing_ok` is set to False (default).
        """
        organization, name = repo_id.split("/") if "/" in repo_id else (None, repo_id)

        path = f"{self.endpoint}/api/repos/delete"

        if repo_type not in constants.REPO_TYPES:
            raise ValueError("Invalid repo type")

        json = {"name": name, "organization": organization}
        if repo_type is not None:
            json["type"] = repo_type

        headers = self._build_hf_headers(token=token)
        r = get_session().delete(path, headers=headers, json=json)
        try:
            hf_raise_for_status(r)
        except RepositoryNotFoundError:
            if not missing_ok:
                raise

    @_deprecate_method(version="0.32", message="Please use `update_repo_settings` instead.")
    @validate_hf_hub_args
    def update_repo_visibility(
        self,
        repo_id: str,
        private: bool = False,
        *,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
    ) -> Dict[str, bool]:
        """Update the visibility setting of a repository.

        Deprecated. Use `update_repo_settings` instead.

        Args:
            repo_id (`str`, *optional*):
                A namespace (user or an organization) and a repo name separated by a `/`.
            private (`bool`, *optional*, defaults to `False`):
                Whether the repository should be private.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.

        Returns:
            The HTTP response in json.

        <Tip>

        Raises the following errors:

            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>
        """
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL  # default repo type

        r = get_session().put(
            url=f"{self.endpoint}/api/{repo_type}s/{repo_id}/settings",
            headers=self._build_hf_headers(token=token),
            json={"private": private},
        )
        hf_raise_for_status(r)
        return r.json()

    @validate_hf_hub_args
    def update_repo_settings(
        self,
        repo_id: str,
        *,
        gated: Optional[Literal["auto", "manual", False]] = None,
        private: Optional[bool] = None,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        xet_enabled: Optional[bool] = None,
    ) -> None:
        """
        Update the settings of a repository, including gated access and visibility.

        To give more control over how repos are used, the Hub allows repo authors to enable
        access requests for their repos, and also to set the visibility of the repo to private.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated by a /.
            gated (`Literal["auto", "manual", False]`, *optional*):
                The gated status for the repository. If set to `None` (default), the `gated` setting of the repository won't be updated.
                * "auto": The repository is gated, and access requests are automatically approved or denied based on predefined criteria.
                * "manual": The repository is gated, and access requests require manual approval.
                * False : The repository is not gated, and anyone can access it.
            private (`bool`, *optional*):
                Whether the repository should be private.
            token (`Union[str, bool, None]`, *optional*):
                A valid user access token (string). Defaults to the locally saved token,
                which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass False.
            repo_type (`str`, *optional*):
                The type of the repository to update settings from (`"model"`, `"dataset"` or `"space"`).
                Defaults to `"model"`.
            xet_enabled (`bool`, *optional*):
                Whether the repository should be enabled for Xet Storage.
        Raises:
            [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
                If gated is not one of "auto", "manual", or False.
            [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
                If repo_type is not one of the values in constants.REPO_TYPES.
            [`~utils.HfHubHTTPError`]:
                If the request to the Hugging Face Hub API fails.
            [`~utils.RepositoryNotFoundError`]
                If the repository to download from cannot be found. This may be because it doesn't exist,
                or because it is set to `private` and you do not have access.
        """

        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL  # default repo type

        # Prepare the JSON payload for the PUT request
        payload: Dict = {}

        if gated is not None:
            if gated not in ["auto", "manual", False]:
                raise ValueError(f"Invalid gated status, must be one of 'auto', 'manual', or False. Got '{gated}'.")
            payload["gated"] = gated

        if private is not None:
            payload["private"] = private

        if xet_enabled is not None:
            payload["xetEnabled"] = xet_enabled

        if len(payload) == 0:
            raise ValueError("At least one setting must be updated.")

        # Build headers
        headers = self._build_hf_headers(token=token)

        r = get_session().put(
            url=f"{self.endpoint}/api/{repo_type}s/{repo_id}/settings",
            headers=headers,
            json=payload,
        )
        hf_raise_for_status(r)

    def move_repo(
        self,
        from_id: str,
        to_id: str,
        *,
        repo_type: Optional[str] = None,
        token: Union[str, bool, None] = None,
    ):
        """
        Moving a repository from namespace1/repo_name1 to namespace2/repo_name2

        Note there are certain limitations. For more information about moving
        repositories, please see
        https://hf.co/docs/hub/repositories-settings#renaming-or-transferring-a-repo.

        Args:
            from_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`. Original repository identifier.
            to_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`. Final repository identifier.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        <Tip>

        Raises the following errors:

            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>
        """
        if len(from_id.split("/")) != 2:
            raise ValueError(f"Invalid repo_id: {from_id}. It should have a namespace (:namespace:/:repo_name:)")

        if len(to_id.split("/")) != 2:
            raise ValueError(f"Invalid repo_id: {to_id}. It should have a namespace (:namespace:/:repo_name:)")

        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL  # Hub won't accept `None`.

        json = {"fromRepo": from_id, "toRepo": to_id, "type": repo_type}

        path = f"{self.endpoint}/api/repos/move"
        headers = self._build_hf_headers(token=token)
        r = get_session().post(path, headers=headers, json=json)
        try:
            hf_raise_for_status(r)
        except HfHubHTTPError as e:
            e.append_to_message(
                "\nFor additional documentation please see"
                " https://hf.co/docs/hub/repositories-settings#renaming-or-transferring-a-repo."
            )
            raise

    @overload
    def create_commit(  # type: ignore
        self,
        repo_id: str,
        operations: Iterable[CommitOperation],
        *,
        commit_message: str,
        commit_description: Optional[str] = None,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        create_pr: Optional[bool] = None,
        num_threads: int = 5,
        parent_commit: Optional[str] = None,
        run_as_future: Literal[False] = ...,
    ) -> CommitInfo: ...

    @overload
    def create_commit(
        self,
        repo_id: str,
        operations: Iterable[CommitOperation],
        *,
        commit_message: str,
        commit_description: Optional[str] = None,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        create_pr: Optional[bool] = None,
        num_threads: int = 5,
        parent_commit: Optional[str] = None,
        run_as_future: Literal[True] = ...,
    ) -> Future[CommitInfo]: ...

    @validate_hf_hub_args
    @future_compatible
    def create_commit(
        self,
        repo_id: str,
        operations: Iterable[CommitOperation],
        *,
        commit_message: str,
        commit_description: Optional[str] = None,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        create_pr: Optional[bool] = None,
        num_threads: int = 5,
        parent_commit: Optional[str] = None,
        run_as_future: bool = False,
    ) -> Union[CommitInfo, Future[CommitInfo]]:
        """
        Creates a commit in the given repo, deleting & uploading files as needed.

        <Tip warning={true}>

        The input list of `CommitOperation` will be mutated during the commit process. Do not reuse the same objects
        for multiple commits.

        </Tip>

        <Tip warning={true}>

        `create_commit` assumes that the repo already exists on the Hub. If you get a
        Client error 404, please make sure you are authenticated and that `repo_id` and
        `repo_type` are set correctly. If repo does not exist, create it first using
        [`~hf_api.create_repo`].

        </Tip>

        <Tip warning={true}>

        `create_commit` is limited to 25k LFS files and a 1GB payload for regular files.

        </Tip>

        Args:
            repo_id (`str`):
                The repository in which the commit will be created, for example:
                `"username/custom_transformers"`

            operations (`Iterable` of [`~hf_api.CommitOperation`]):
                An iterable of operations to include in the commit, either:

                    - [`~hf_api.CommitOperationAdd`] to upload a file
                    - [`~hf_api.CommitOperationDelete`] to delete a file
                    - [`~hf_api.CommitOperationCopy`] to copy a file

                Operation objects will be mutated to include information relative to the upload. Do not reuse the
                same objects for multiple commits.

            commit_message (`str`):
                The summary (first line) of the commit that will be created.

            commit_description (`str`, *optional*):
                The description of the commit that will be created

            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.

            revision (`str`, *optional*):
                The git revision to commit from. Defaults to the head of the `"main"` branch.

            create_pr (`boolean`, *optional*):
                Whether or not to create a Pull Request with that commit. Defaults to `False`.
                If `revision` is not set, PR is opened against the `"main"` branch. If
                `revision` is set and is a branch, PR is opened against this branch. If
                `revision` is set and is not a branch name (example: a commit oid), an
                `RevisionNotFoundError` is returned by the server.

            num_threads (`int`, *optional*):
                Number of concurrent threads for uploading files. Defaults to 5.
                Setting it to 2 means at most 2 files will be uploaded concurrently.

            parent_commit (`str`, *optional*):
                The OID / SHA of the parent commit, as a hexadecimal string.
                Shorthands (7 first characters) are also supported. If specified and `create_pr` is `False`,
                the commit will fail if `revision` does not point to `parent_commit`. If specified and `create_pr`
                is `True`, the pull request will be created from `parent_commit`. Specifying `parent_commit`
                ensures the repo has not changed before committing the changes, and can be especially useful
                if the repo is updated / committed to concurrently.
            run_as_future (`bool`, *optional*):
                Whether or not to run this method in the background. Background jobs are run sequentially without
                blocking the main thread. Passing `run_as_future=True` will return a [Future](https://docs.python.org/3/library/concurrent.futures.html#future-objects)
                object. Defaults to `False`.

        Returns:
            [`CommitInfo`] or `Future`:
                Instance of [`CommitInfo`] containing information about the newly created commit (commit hash, commit
                url, pr url, commit message,...). If `run_as_future=True` is passed, returns a Future object which will
                contain the result when executed.

        Raises:
            [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
                If commit message is empty.
            [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
                If parent commit is not a valid commit OID.
            [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
                If a README.md file with an invalid metadata section is committed. In this case, the commit will fail
                early, before trying to upload any file.
            [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
                If `create_pr` is `True` and revision is neither `None` nor `"main"`.
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private
                but not authenticated or repo does not exist.
        """
        if parent_commit is not None and not constants.REGEX_COMMIT_OID.fullmatch(parent_commit):
            raise ValueError(
                f"`parent_commit` is not a valid commit OID. It must match the following regex: {constants.REGEX_COMMIT_OID}"
            )

        if commit_message is None or len(commit_message) == 0:
            raise ValueError("`commit_message` can't be empty, please pass a value.")

        commit_description = commit_description if commit_description is not None else ""
        repo_type = repo_type if repo_type is not None else constants.REPO_TYPE_MODEL
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        unquoted_revision = revision or constants.DEFAULT_REVISION
        revision = quote(unquoted_revision, safe="")
        create_pr = create_pr if create_pr is not None else False

        headers = self._build_hf_headers(token=token)

        operations = list(operations)
        additions = [op for op in operations if isinstance(op, CommitOperationAdd)]
        copies = [op for op in operations if isinstance(op, CommitOperationCopy)]
        nb_additions = len(additions)
        nb_copies = len(copies)
        nb_deletions = len(operations) - nb_additions - nb_copies

        for addition in additions:
            if addition._is_committed:
                raise ValueError(
                    f"CommitOperationAdd {addition} has already being committed and cannot be reused. Please create a"
                    " new CommitOperationAdd object if you want to create a new commit."
                )

        if repo_type != "dataset":
            for addition in additions:
                if addition.path_in_repo.endswith((".arrow", ".parquet")):
                    warnings.warn(
                        f"It seems that you are about to commit a data file ({addition.path_in_repo}) to a {repo_type}"
                        " repository. You are sure this is intended? If you are trying to upload a dataset, please"
                        " set `repo_type='dataset'` or `--repo-type=dataset` in a CLI."
                    )

        logger.debug(
            f"About to commit to the hub: {len(additions)} addition(s), {len(copies)} copie(s) and"
            f" {nb_deletions} deletion(s)."
        )

        # If updating a README.md file, make sure the metadata format is valid
        # It's better to fail early than to fail after all the files have been uploaded.
        for addition in additions:
            if addition.path_in_repo == "README.md":
                with addition.as_file() as file:
                    content = file.read().decode()
                self._validate_yaml(content, repo_type=repo_type, token=token)
                # Skip other additions after `README.md` has been processed
                break

        # If updating twice the same file or update then delete a file in a single commit
        _warn_on_overwriting_operations(operations)

        self.preupload_lfs_files(
            repo_id=repo_id,
            additions=additions,
            token=token,
            repo_type=repo_type,
            revision=unquoted_revision,  # first-class methods take unquoted revision
            create_pr=create_pr,
            num_threads=num_threads,
            free_memory=False,  # do not remove `CommitOperationAdd.path_or_fileobj` on LFS files for "normal" users
        )

        files_to_copy = _fetch_files_to_copy(
            copies=copies,
            repo_type=repo_type,
            repo_id=repo_id,
            headers=headers,
            revision=unquoted_revision,
            endpoint=self.endpoint,
        )
        # Remove no-op operations (files that have not changed)
        operations_without_no_op = []
        for operation in operations:
            if (
                isinstance(operation, CommitOperationAdd)
                and operation._remote_oid is not None
                and operation._remote_oid == operation._local_oid
            ):
                # File already exists on the Hub and has not changed: we can skip it.
                logger.debug(f"Skipping upload for '{operation.path_in_repo}' as the file has not changed.")
                continue
            if (
                isinstance(operation, CommitOperationCopy)
                and operation._dest_oid is not None
                and operation._dest_oid == operation._src_oid
            ):
                # Source and destination files are identical - skip
                logger.debug(
                    f"Skipping copy for '{operation.src_path_in_repo}' -> '{operation.path_in_repo}' as the content of the source file is the same as the destination file."
                )
                continue
            operations_without_no_op.append(operation)
        if len(operations) != len(operations_without_no_op):
            logger.info(
                f"Removing {len(operations) - len(operations_without_no_op)} file(s) from commit that have not changed."
            )

        # Return early if empty commit
        if len(operations_without_no_op) == 0:
            logger.warning("No files have been modified since last commit. Skipping to prevent empty commit.")

            # Get latest commit info
            try:
                info = self.repo_info(repo_id=repo_id, repo_type=repo_type, revision=unquoted_revision, token=token)
            except RepositoryNotFoundError as e:
                e.append_to_message(_CREATE_COMMIT_NO_REPO_ERROR_MESSAGE)
                raise

            # Return commit info based on latest commit
            url_prefix = self.endpoint
            if repo_type is not None and repo_type != constants.REPO_TYPE_MODEL:
                url_prefix = f"{url_prefix}/{repo_type}s"
            return CommitInfo(
                commit_url=f"{url_prefix}/{repo_id}/commit/{info.sha}",
                commit_message=commit_message,
                commit_description=commit_description,
                oid=info.sha,  # type: ignore[arg-type]
            )

        commit_payload = _prepare_commit_payload(
            operations=operations,
            files_to_copy=files_to_copy,
            commit_message=commit_message,
            commit_description=commit_description,
            parent_commit=parent_commit,
        )
        commit_url = f"{self.endpoint}/api/{repo_type}s/{repo_id}/commit/{revision}"

        def _payload_as_ndjson() -> Iterable[bytes]:
            for item in commit_payload:
                yield json.dumps(item).encode()
                yield b"\n"

        headers = {
            # See https://github.com/huggingface/huggingface_hub/issues/1085#issuecomment-1265208073
            "Content-Type": "application/x-ndjson",
            **headers,
        }
        data = b"".join(_payload_as_ndjson())
        params = {"create_pr": "1"} if create_pr else None

        try:
            commit_resp = get_session().post(url=commit_url, headers=headers, data=data, params=params)
            hf_raise_for_status(commit_resp, endpoint_name="commit")
        except RepositoryNotFoundError as e:
            e.append_to_message(_CREATE_COMMIT_NO_REPO_ERROR_MESSAGE)
            raise
        except EntryNotFoundError as e:
            if nb_deletions > 0 and "A file with this name doesn't exist" in str(e):
                e.append_to_message(
                    "\nMake sure to differentiate file and folder paths in delete"
                    " operations with a trailing '/' or using `is_folder=True/False`."
                )
            raise

        # Mark additions as committed (cannot be reused in another commit)
        for addition in additions:
            addition._is_committed = True

        commit_data = commit_resp.json()
        return CommitInfo(
            commit_url=commit_data["commitUrl"],
            commit_message=commit_message,
            commit_description=commit_description,
            oid=commit_data["commitOid"],
            pr_url=commit_data["pullRequestUrl"] if create_pr else None,
        )

    def preupload_lfs_files(
        self,
        repo_id: str,
        additions: Iterable[CommitOperationAdd],
        *,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        create_pr: Optional[bool] = None,
        num_threads: int = 5,
        free_memory: bool = True,
        gitignore_content: Optional[str] = None,
    ):
        """Pre-upload LFS files to S3 in preparation on a future commit.

        This method is useful if you are generating the files to upload on-the-fly and you don't want to store them
        in memory before uploading them all at once.

        <Tip warning={true}>

        This is a power-user method. You shouldn't need to call it directly to make a normal commit.
        Use [`create_commit`] directly instead.

        </Tip>

        <Tip warning={true}>

        Commit operations will be mutated during the process. In particular, the attached `path_or_fileobj` will be
        removed after the upload to save memory (and replaced by an empty `bytes` object). Do not reuse the same
        objects except to pass them to [`create_commit`]. If you don't want to remove the attached content from the
        commit operation object, pass `free_memory=False`.

        </Tip>

        Args:
            repo_id (`str`):
                The repository in which you will commit the files, for example: `"username/custom_transformers"`.

            operations (`Iterable` of [`CommitOperationAdd`]):
                The list of files to upload. Warning: the objects in this list will be mutated to include information
                relative to the upload. Do not reuse the same objects for multiple commits.

            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

            repo_type (`str`, *optional*):
                The type of repository to upload to (e.g. `"model"` -default-, `"dataset"` or `"space"`).

            revision (`str`, *optional*):
                The git revision to commit from. Defaults to the head of the `"main"` branch.

            create_pr (`boolean`, *optional*):
                Whether or not you plan to create a Pull Request with that commit. Defaults to `False`.

            num_threads (`int`, *optional*):
                Number of concurrent threads for uploading files. Defaults to 5.
                Setting it to 2 means at most 2 files will be uploaded concurrently.

            gitignore_content (`str`, *optional*):
                The content of the `.gitignore` file to know which files should be ignored. The order of priority
                is to first check if `gitignore_content` is passed, then check if the `.gitignore` file is present
                in the list of files to commit and finally default to the `.gitignore` file already hosted on the Hub
                (if any).

        Example:
        ```py
        >>> from huggingface_hub import CommitOperationAdd, preupload_lfs_files, create_commit, create_repo

        >>> repo_id = create_repo("test_preupload").repo_id

        # Generate and preupload LFS files one by one
        >>> operations = [] # List of all `CommitOperationAdd` objects that will be generated
        >>> for i in range(5):
        ...     content = ... # generate binary content
        ...     addition = CommitOperationAdd(path_in_repo=f"shard_{i}_of_5.bin", path_or_fileobj=content)
        ...     preupload_lfs_files(repo_id, additions=[addition]) # upload + free memory
        ...     operations.append(addition)

        # Create commit
        >>> create_commit(repo_id, operations=operations, commit_message="Commit all shards")
        ```
        """
        repo_type = repo_type if repo_type is not None else constants.REPO_TYPE_MODEL
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        revision = quote(revision, safe="") if revision is not None else constants.DEFAULT_REVISION
        create_pr = create_pr if create_pr is not None else False
        headers = self._build_hf_headers(token=token)

        # Check if a `gitignore` file is being committed to the Hub.
        additions = list(additions)
        if gitignore_content is None:
            for addition in additions:
                if addition.path_in_repo == ".gitignore":
                    with addition.as_file() as f:
                        gitignore_content = f.read().decode()
                        break

        # Filter out already uploaded files
        new_additions = [addition for addition in additions if not addition._is_uploaded]

        # Check which new files are LFS
        # For some items, we might have already fetched the upload mode (in case of upload_large_folder)
        additions_no_upload_mode = [addition for addition in new_additions if addition._upload_mode is None]
        if len(additions_no_upload_mode) > 0:
            try:
                _fetch_upload_modes(
                    additions=additions_no_upload_mode,
                    repo_type=repo_type,
                    repo_id=repo_id,
                    headers=headers,
                    revision=revision,
                    endpoint=self.endpoint,
                    create_pr=create_pr or False,
                    gitignore_content=gitignore_content,
                )
            except RepositoryNotFoundError as e:
                e.append_to_message(_CREATE_COMMIT_NO_REPO_ERROR_MESSAGE)
                raise

        # Filter out regular files
        new_lfs_additions = [addition for addition in new_additions if addition._upload_mode == "lfs"]

        # Filter out files listed in .gitignore
        new_lfs_additions_to_upload = []
        for addition in new_lfs_additions:
            if addition._should_ignore:
                logger.debug(f"Skipping upload for LFS file '{addition.path_in_repo}' (ignored by gitignore file).")
            else:
                new_lfs_additions_to_upload.append(addition)
        if len(new_lfs_additions) != len(new_lfs_additions_to_upload):
            logger.info(
                f"Skipped upload for {len(new_lfs_additions) - len(new_lfs_additions_to_upload)} LFS file(s) "
                "(ignored by gitignore file)."
            )
        # Prepare upload parameters
        upload_kwargs = {
            "additions": new_lfs_additions_to_upload,
            "repo_type": repo_type,
            "repo_id": repo_id,
            "headers": headers,
            "endpoint": self.endpoint,
            # If `create_pr`, we don't want to check user permission on the revision as users with read permission
            # should still be able to create PRs even if they don't have write permission on the target branch of the
            # PR (i.e. `revision`).
            "revision": revision if not create_pr else None,
        }
        # Upload files using Xet protocol if all of the following are true:
        # - xet is enabled for the repo,
        # - the files are provided as str or paths objects,
        # - the library is installed.
        # Otherwise, default back to LFS.
        xet_enabled = self.repo_info(
            repo_id=repo_id,
            repo_type=repo_type,
            revision=unquote(revision) if revision is not None else revision,
            expand="xetEnabled",
            token=token,
        ).xet_enabled
        has_buffered_io_data = any(
            isinstance(addition.path_or_fileobj, io.BufferedIOBase) for addition in new_lfs_additions_to_upload
        )
        if xet_enabled and not has_buffered_io_data and is_xet_available():
            logger.debug("Uploading files using Xet Storage..")
            _upload_xet_files(**upload_kwargs, create_pr=create_pr)  # type: ignore [arg-type]
        else:
            if xet_enabled and is_xet_available():
                if has_buffered_io_data:
                    logger.warning(
                        "Uploading files as a binary IO buffer is not supported by Xet Storage. "
                        "Falling back to HTTP upload."
                    )
            _upload_lfs_files(**upload_kwargs, num_threads=num_threads)  # type: ignore [arg-type]
        for addition in new_lfs_additions_to_upload:
            addition._is_uploaded = True
            if free_memory:
                addition.path_or_fileobj = b""

    @overload
    def upload_file(  # type: ignore
        self,
        *,
        path_or_fileobj: Union[str, Path, bytes, BinaryIO],
        path_in_repo: str,
        repo_id: str,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
        run_as_future: Literal[False] = ...,
    ) -> CommitInfo: ...

    @overload
    def upload_file(
        self,
        *,
        path_or_fileobj: Union[str, Path, bytes, BinaryIO],
        path_in_repo: str,
        repo_id: str,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
        run_as_future: Literal[True] = ...,
    ) -> Future[CommitInfo]: ...

    @validate_hf_hub_args
    @future_compatible
    def upload_file(
        self,
        *,
        path_or_fileobj: Union[str, Path, bytes, BinaryIO],
        path_in_repo: str,
        repo_id: str,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
        run_as_future: bool = False,
    ) -> Union[CommitInfo, Future[CommitInfo]]:
        """
        Upload a local file (up to 50 GB) to the given repo. The upload is done
        through a HTTP post request, and doesn't require git or git-lfs to be
        installed.

        Args:
            path_or_fileobj (`str`, `Path`, `bytes`, or `IO`):
                Path to a file on the local machine or binary data stream /
                fileobj / buffer.
            path_in_repo (`str`):
                Relative filepath in the repo, for example:
                `"checkpoints/1fec34a/weights.bin"`
            repo_id (`str`):
                The repository to which the file will be uploaded, for example:
                `"username/custom_transformers"`
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            revision (`str`, *optional*):
                The git revision to commit from. Defaults to the head of the `"main"` branch.
            commit_message (`str`, *optional*):
                The summary / title / first line of the generated commit
            commit_description (`str` *optional*)
                The description of the generated commit
            create_pr (`boolean`, *optional*):
                Whether or not to create a Pull Request with that commit. Defaults to `False`.
                If `revision` is not set, PR is opened against the `"main"` branch. If
                `revision` is set and is a branch, PR is opened against this branch. If
                `revision` is set and is not a branch name (example: a commit oid), an
                `RevisionNotFoundError` is returned by the server.
            parent_commit (`str`, *optional*):
                The OID / SHA of the parent commit, as a hexadecimal string. Shorthands (7 first characters) are also supported.
                If specified and `create_pr` is `False`, the commit will fail if `revision` does not point to `parent_commit`.
                If specified and `create_pr` is `True`, the pull request will be created from `parent_commit`.
                Specifying `parent_commit` ensures the repo has not changed before committing the changes, and can be
                especially useful if the repo is updated / committed to concurrently.
            run_as_future (`bool`, *optional*):
                Whether or not to run this method in the background. Background jobs are run sequentially without
                blocking the main thread. Passing `run_as_future=True` will return a [Future](https://docs.python.org/3/library/concurrent.futures.html#future-objects)
                object. Defaults to `False`.


        Returns:
            [`CommitInfo`] or `Future`:
                Instance of [`CommitInfo`] containing information about the newly created commit (commit hash, commit
                url, pr url, commit message,...). If `run_as_future=True` is passed, returns a Future object which will
                contain the result when executed.
        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.
            - [`~utils.RevisionNotFoundError`]
              If the revision to download from cannot be found.

        </Tip>

        <Tip warning={true}>

        `upload_file` assumes that the repo already exists on the Hub. If you get a
        Client error 404, please make sure you are authenticated and that `repo_id` and
        `repo_type` are set correctly. If repo does not exist, create it first using
        [`~hf_api.create_repo`].

        </Tip>

        Example:

        ```python
        >>> from huggingface_hub import upload_file

        >>> with open("./local/filepath", "rb") as fobj:
        ...     upload_file(
        ...         path_or_fileobj=fileobj,
        ...         path_in_repo="remote/file/path.h5",
        ...         repo_id="username/my-dataset",
        ...         repo_type="dataset",
        ...         token="my_token",
        ...     )
        "https://huggingface.co/datasets/username/my-dataset/blob/main/remote/file/path.h5"

        >>> upload_file(
        ...     path_or_fileobj=".\\\\local\\\\file\\\\path",
        ...     path_in_repo="remote/file/path.h5",
        ...     repo_id="username/my-model",
        ...     token="my_token",
        ... )
        "https://huggingface.co/username/my-model/blob/main/remote/file/path.h5"

        >>> upload_file(
        ...     path_or_fileobj=".\\\\local\\\\file\\\\path",
        ...     path_in_repo="remote/file/path.h5",
        ...     repo_id="username/my-model",
        ...     token="my_token",
        ...     create_pr=True,
        ... )
        "https://huggingface.co/username/my-model/blob/refs%2Fpr%2F1/remote/file/path.h5"
        ```
        """
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")

        commit_message = (
            commit_message if commit_message is not None else f"Upload {path_in_repo} with huggingface_hub"
        )
        operation = CommitOperationAdd(
            path_or_fileobj=path_or_fileobj,
            path_in_repo=path_in_repo,
        )

        commit_info = self.create_commit(
            repo_id=repo_id,
            repo_type=repo_type,
            operations=[operation],
            commit_message=commit_message,
            commit_description=commit_description,
            token=token,
            revision=revision,
            create_pr=create_pr,
            parent_commit=parent_commit,
        )

        if commit_info.pr_url is not None:
            revision = quote(_parse_revision_from_pr_url(commit_info.pr_url), safe="")
        if repo_type in constants.REPO_TYPES_URL_PREFIXES:
            repo_id = constants.REPO_TYPES_URL_PREFIXES[repo_type] + repo_id
        revision = revision if revision is not None else constants.DEFAULT_REVISION

        return CommitInfo(
            commit_url=commit_info.commit_url,
            commit_message=commit_info.commit_message,
            commit_description=commit_info.commit_description,
            oid=commit_info.oid,
            pr_url=commit_info.pr_url,
            # Similar to `hf_hub_url` but it's "blob" instead of "resolve"
            # TODO: remove this in v1.0
            _url=f"{self.endpoint}/{repo_id}/blob/{revision}/{path_in_repo}",
        )

    @overload
    def upload_folder(  # type: ignore
        self,
        *,
        repo_id: str,
        folder_path: Union[str, Path],
        path_in_repo: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
        allow_patterns: Optional[Union[List[str], str]] = None,
        ignore_patterns: Optional[Union[List[str], str]] = None,
        delete_patterns: Optional[Union[List[str], str]] = None,
        run_as_future: Literal[False] = ...,
    ) -> CommitInfo: ...

    @overload
    def upload_folder(  # type: ignore
        self,
        *,
        repo_id: str,
        folder_path: Union[str, Path],
        path_in_repo: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
        allow_patterns: Optional[Union[List[str], str]] = None,
        ignore_patterns: Optional[Union[List[str], str]] = None,
        delete_patterns: Optional[Union[List[str], str]] = None,
        run_as_future: Literal[True] = ...,
    ) -> Future[CommitInfo]: ...

    @validate_hf_hub_args
    @future_compatible
    def upload_folder(
        self,
        *,
        repo_id: str,
        folder_path: Union[str, Path],
        path_in_repo: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
        allow_patterns: Optional[Union[List[str], str]] = None,
        ignore_patterns: Optional[Union[List[str], str]] = None,
        delete_patterns: Optional[Union[List[str], str]] = None,
        run_as_future: bool = False,
    ) -> Union[CommitInfo, Future[CommitInfo]]:
        """
        Upload a local folder to the given repo. The upload is done through a HTTP requests, and doesn't require git or
        git-lfs to be installed.

        The structure of the folder will be preserved. Files with the same name already present in the repository will
        be overwritten. Others will be left untouched.

        Use the `allow_patterns` and `ignore_patterns` arguments to specify which files to upload. These parameters
        accept either a single pattern or a list of patterns. Patterns are Standard Wildcards (globbing patterns) as
        documented [here](https://tldp.org/LDP/GNU-Linux-Tools-Summary/html/x11655.htm). If both `allow_patterns` and
        `ignore_patterns` are provided, both constraints apply. By default, all files from the folder are uploaded.

        Use the `delete_patterns` argument to specify remote files you want to delete. Input type is the same as for
        `allow_patterns` (see above). If `path_in_repo` is also provided, the patterns are matched against paths
        relative to this folder. For example, `upload_folder(..., path_in_repo="experiment", delete_patterns="logs/*")`
        will delete any remote file under `./experiment/logs/`. Note that the `.gitattributes` file will not be deleted
        even if it matches the patterns.

        Any `.git/` folder present in any subdirectory will be ignored. However, please be aware that the `.gitignore`
        file is not taken into account.

        Uses `HfApi.create_commit` under the hood.

        Args:
            repo_id (`str`):
                The repository to which the file will be uploaded, for example:
                `"username/custom_transformers"`
            folder_path (`str` or `Path`):
                Path to the folder to upload on the local file system
            path_in_repo (`str`, *optional*):
                Relative path of the directory in the repo, for example:
                `"checkpoints/1fec34a/results"`. Will default to the root folder of the repository.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            revision (`str`, *optional*):
                The git revision to commit from. Defaults to the head of the `"main"` branch.
            commit_message (`str`, *optional*):
                The summary / title / first line of the generated commit. Defaults to:
                `f"Upload {path_in_repo} with huggingface_hub"`
            commit_description (`str` *optional*):
                The description of the generated commit
            create_pr (`boolean`, *optional*):
                Whether or not to create a Pull Request with that commit. Defaults to `False`. If `revision` is not
                set, PR is opened against the `"main"` branch. If `revision` is set and is a branch, PR is opened
                against this branch. If `revision` is set and is not a branch name (example: a commit oid), an
                `RevisionNotFoundError` is returned by the server.
            parent_commit (`str`, *optional*):
                The OID / SHA of the parent commit, as a hexadecimal string. Shorthands (7 first characters) are also supported.
                If specified and `create_pr` is `False`, the commit will fail if `revision` does not point to `parent_commit`.
                If specified and `create_pr` is `True`, the pull request will be created from `parent_commit`.
                Specifying `parent_commit` ensures the repo has not changed before committing the changes, and can be
                especially useful if the repo is updated / committed to concurrently.
            allow_patterns (`List[str]` or `str`, *optional*):
                If provided, only files matching at least one pattern are uploaded.
            ignore_patterns (`List[str]` or `str`, *optional*):
                If provided, files matching any of the patterns are not uploaded.
            delete_patterns (`List[str]` or `str`, *optional*):
                If provided, remote files matching any of the patterns will be deleted from the repo while committing
                new files. This is useful if you don't know which files have already been uploaded.
                Note: to avoid discrepancies the `.gitattributes` file is not deleted even if it matches the pattern.
            run_as_future (`bool`, *optional*):
                Whether or not to run this method in the background. Background jobs are run sequentially without
                blocking the main thread. Passing `run_as_future=True` will return a [Future](https://docs.python.org/3/library/concurrent.futures.html#future-objects)
                object. Defaults to `False`.

        Returns:
            [`CommitInfo`] or `Future`:
                Instance of [`CommitInfo`] containing information about the newly created commit (commit hash, commit
                url, pr url, commit message,...). If `run_as_future=True` is passed, returns a Future object which will
                contain the result when executed.

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
            if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            if some parameter value is invalid

        </Tip>

        <Tip warning={true}>

        `upload_folder` assumes that the repo already exists on the Hub. If you get a Client error 404, please make
        sure you are authenticated and that `repo_id` and `repo_type` are set correctly. If repo does not exist, create
        it first using [`~hf_api.create_repo`].

        </Tip>

        <Tip>

        When dealing with a large folder (thousands of files or hundreds of GB), we recommend using [`~hf_api.upload_large_folder`] instead.

        </Tip>

        Example:

        ```python
        # Upload checkpoints folder except the log files
        >>> upload_folder(
        ...     folder_path="local/checkpoints",
        ...     path_in_repo="remote/experiment/checkpoints",
        ...     repo_id="username/my-dataset",
        ...     repo_type="datasets",
        ...     token="my_token",
        ...     ignore_patterns="**/logs/*.txt",
        ... )
        # "https://huggingface.co/datasets/username/my-dataset/tree/main/remote/experiment/checkpoints"

        # Upload checkpoints folder including logs while deleting existing logs from the repo
        # Useful if you don't know exactly which log files have already being pushed
        >>> upload_folder(
        ...     folder_path="local/checkpoints",
        ...     path_in_repo="remote/experiment/checkpoints",
        ...     repo_id="username/my-dataset",
        ...     repo_type="datasets",
        ...     token="my_token",
        ...     delete_patterns="**/logs/*.txt",
        ... )
        "https://huggingface.co/datasets/username/my-dataset/tree/main/remote/experiment/checkpoints"

        # Upload checkpoints folder while creating a PR
        >>> upload_folder(
        ...     folder_path="local/checkpoints",
        ...     path_in_repo="remote/experiment/checkpoints",
        ...     repo_id="username/my-dataset",
        ...     repo_type="datasets",
        ...     token="my_token",
        ...     create_pr=True,
        ... )
        "https://huggingface.co/datasets/username/my-dataset/tree/refs%2Fpr%2F1/remote/experiment/checkpoints"

        ```
        """
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")

        # By default, upload folder to the root directory in repo.
        if path_in_repo is None:
            path_in_repo = ""

        # Do not upload .git folder
        if ignore_patterns is None:
            ignore_patterns = []
        elif isinstance(ignore_patterns, str):
            ignore_patterns = [ignore_patterns]
        ignore_patterns += DEFAULT_IGNORE_PATTERNS

        delete_operations = self._prepare_folder_deletions(
            repo_id=repo_id,
            repo_type=repo_type,
            revision=constants.DEFAULT_REVISION if create_pr else revision,
            token=token,
            path_in_repo=path_in_repo,
            delete_patterns=delete_patterns,
        )
        add_operations = self._prepare_upload_folder_additions(
            folder_path,
            path_in_repo,
            allow_patterns=allow_patterns,
            ignore_patterns=ignore_patterns,
            token=token,
            repo_type=repo_type,
        )

        # Optimize operations: if some files will be overwritten, we don't need to delete them first
        if len(add_operations) > 0:
            added_paths = set(op.path_in_repo for op in add_operations)
            delete_operations = [
                delete_op for delete_op in delete_operations if delete_op.path_in_repo not in added_paths
            ]
        commit_operations = delete_operations + add_operations

        commit_message = commit_message or "Upload folder using huggingface_hub"

        commit_info = self.create_commit(
            repo_type=repo_type,
            repo_id=repo_id,
            operations=commit_operations,
            commit_message=commit_message,
            commit_description=commit_description,
            token=token,
            revision=revision,
            create_pr=create_pr,
            parent_commit=parent_commit,
        )

        # Create url to uploaded folder (for legacy return value)
        if create_pr and commit_info.pr_url is not None:
            revision = quote(_parse_revision_from_pr_url(commit_info.pr_url), safe="")
        if repo_type in constants.REPO_TYPES_URL_PREFIXES:
            repo_id = constants.REPO_TYPES_URL_PREFIXES[repo_type] + repo_id
        revision = revision if revision is not None else constants.DEFAULT_REVISION

        return CommitInfo(
            commit_url=commit_info.commit_url,
            commit_message=commit_info.commit_message,
            commit_description=commit_info.commit_description,
            oid=commit_info.oid,
            pr_url=commit_info.pr_url,
            # Similar to `hf_hub_url` but it's "tree" instead of "resolve"
            # TODO: remove this in v1.0
            _url=f"{self.endpoint}/{repo_id}/tree/{revision}/{path_in_repo}",
        )

    @validate_hf_hub_args
    def delete_file(
        self,
        path_in_repo: str,
        repo_id: str,
        *,
        token: Union[str, bool, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
    ) -> CommitInfo:
        """
        Deletes a file in the given repo.

        Args:
            path_in_repo (`str`):
                Relative filepath in the repo, for example:
                `"checkpoints/1fec34a/weights.bin"`
            repo_id (`str`):
                The repository from which the file will be deleted, for example:
                `"username/custom_transformers"`
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if the file is in a dataset or
                space, `None` or `"model"` if in a model. Default is `None`.
            revision (`str`, *optional*):
                The git revision to commit from. Defaults to the head of the `"main"` branch.
            commit_message (`str`, *optional*):
                The summary / title / first line of the generated commit. Defaults to
                `f"Delete {path_in_repo} with huggingface_hub"`.
            commit_description (`str` *optional*)
                The description of the generated commit
            create_pr (`boolean`, *optional*):
                Whether or not to create a Pull Request with that commit. Defaults to `False`.
                If `revision` is not set, PR is opened against the `"main"` branch. If
                `revision` is set and is a branch, PR is opened against this branch. If
                `revision` is set and is not a branch name (example: a commit oid), an
                `RevisionNotFoundError` is returned by the server.
            parent_commit (`str`, *optional*):
                The OID / SHA of the parent commit, as a hexadecimal string. Shorthands (7 first characters) are also supported.
                If specified and `create_pr` is `False`, the commit will fail if `revision` does not point to `parent_commit`.
                If specified and `create_pr` is `True`, the pull request will be created from `parent_commit`.
                Specifying `parent_commit` ensures the repo has not changed before committing the changes, and can be
                especially useful if the repo is updated / committed to concurrently.


        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.
            - [`~utils.RevisionNotFoundError`]
              If the revision to download from cannot be found.
            - [`~utils.EntryNotFoundError`]
              If the file to download cannot be found.

        </Tip>

        """
        commit_message = (
            commit_message if commit_message is not None else f"Delete {path_in_repo} with huggingface_hub"
        )

        operations = [CommitOperationDelete(path_in_repo=path_in_repo)]

        return self.create_commit(
            repo_id=repo_id,
            repo_type=repo_type,
            token=token,
            operations=operations,
            revision=revision,
            commit_message=commit_message,
            commit_description=commit_description,
            create_pr=create_pr,
            parent_commit=parent_commit,
        )

    @validate_hf_hub_args
    def delete_files(
        self,
        repo_id: str,
        delete_patterns: List[str],
        *,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
    ) -> CommitInfo:
        """
        Delete files from a repository on the Hub.

        If a folder path is provided, the entire folder is deleted as well as
        all files it contained.

        Args:
            repo_id (`str`):
                The repository from which the folder will be deleted, for example:
                `"username/custom_transformers"`
            delete_patterns (`List[str]`):
                List of files or folders to delete. Each string can either be
                a file path, a folder path or a Unix shell-style wildcard.
                E.g. `["file.txt", "folder/", "data/*.parquet"]`
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
                to the stored token.
            repo_type (`str`, *optional*):
                Type of the repo to delete files from. Can be `"model"`,
                `"dataset"` or `"space"`. Defaults to `"model"`.
            revision (`str`, *optional*):
                The git revision to commit from. Defaults to the head of the `"main"` branch.
            commit_message (`str`, *optional*):
                The summary (first line) of the generated commit. Defaults to
                `f"Delete files using huggingface_hub"`.
            commit_description (`str` *optional*)
                The description of the generated commit.
            create_pr (`boolean`, *optional*):
                Whether or not to create a Pull Request with that commit. Defaults to `False`.
                If `revision` is not set, PR is opened against the `"main"` branch. If
                `revision` is set and is a branch, PR is opened against this branch. If
                `revision` is set and is not a branch name (example: a commit oid), an
                `RevisionNotFoundError` is returned by the server.
            parent_commit (`str`, *optional*):
                The OID / SHA of the parent commit, as a hexadecimal string. Shorthands (7 first characters) are also supported.
                If specified and `create_pr` is `False`, the commit will fail if `revision` does not point to `parent_commit`.
                If specified and `create_pr` is `True`, the pull request will be created from `parent_commit`.
                Specifying `parent_commit` ensures the repo has not changed before committing the changes, and can be
                especially useful if the repo is updated / committed to concurrently.
        """
        operations = self._prepare_folder_deletions(
            repo_id=repo_id, repo_type=repo_type, delete_patterns=delete_patterns, path_in_repo="", revision=revision
        )

        if commit_message is None:
            commit_message = f"Delete files {' '.join(delete_patterns)} with huggingface_hub"

        return self.create_commit(
            repo_id=repo_id,
            repo_type=repo_type,
            token=token,
            operations=operations,
            revision=revision,
            commit_message=commit_message,
            commit_description=commit_description,
            create_pr=create_pr,
            parent_commit=parent_commit,
        )

    @validate_hf_hub_args
    def delete_folder(
        self,
        path_in_repo: str,
        repo_id: str,
        *,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
    ) -> CommitInfo:
        """
        Deletes a folder in the given repo.

        Simple wrapper around [`create_commit`] method.

        Args:
            path_in_repo (`str`):
                Relative folder path in the repo, for example: `"checkpoints/1fec34a"`.
            repo_id (`str`):
                The repository from which the folder will be deleted, for example:
                `"username/custom_transformers"`
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
                to the stored token.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if the folder is in a dataset or
                space, `None` or `"model"` if in a model. Default is `None`.
            revision (`str`, *optional*):
                The git revision to commit from. Defaults to the head of the `"main"` branch.
            commit_message (`str`, *optional*):
                The summary / title / first line of the generated commit. Defaults to
                `f"Delete folder {path_in_repo} with huggingface_hub"`.
            commit_description (`str` *optional*)
                The description of the generated commit.
            create_pr (`boolean`, *optional*):
                Whether or not to create a Pull Request with that commit. Defaults to `False`.
                If `revision` is not set, PR is opened against the `"main"` branch. If
                `revision` is set and is a branch, PR is opened against this branch. If
                `revision` is set and is not a branch name (example: a commit oid), an
                `RevisionNotFoundError` is returned by the server.
            parent_commit (`str`, *optional*):
                The OID / SHA of the parent commit, as a hexadecimal string. Shorthands (7 first characters) are also supported.
                If specified and `create_pr` is `False`, the commit will fail if `revision` does not point to `parent_commit`.
                If specified and `create_pr` is `True`, the pull request will be created from `parent_commit`.
                Specifying `parent_commit` ensures the repo has not changed before committing the changes, and can be
                especially useful if the repo is updated / committed to concurrently.
        """
        return self.create_commit(
            repo_id=repo_id,
            repo_type=repo_type,
            token=token,
            operations=[CommitOperationDelete(path_in_repo=path_in_repo, is_folder=True)],
            revision=revision,
            commit_message=(
                commit_message if commit_message is not None else f"Delete folder {path_in_repo} with huggingface_hub"
            ),
            commit_description=commit_description,
            create_pr=create_pr,
            parent_commit=parent_commit,
        )

    def upload_large_folder(
        self,
        repo_id: str,
        folder_path: Union[str, Path],
        *,
        repo_type: str,  # Repo type is required!
        revision: Optional[str] = None,
        private: Optional[bool] = None,
        allow_patterns: Optional[Union[List[str], str]] = None,
        ignore_patterns: Optional[Union[List[str], str]] = None,
        num_workers: Optional[int] = None,
        print_report: bool = True,
        print_report_every: int = 60,
    ) -> None:
        """Upload a large folder to the Hub in the most resilient way possible.

        Several workers are started to upload files in an optimized way. Before being committed to a repo, files must be
        hashed and be pre-uploaded if they are LFS files. Workers will perform these tasks for each file in the folder.
        At each step, some metadata information about the upload process is saved in the folder under `.cache/.huggingface/`
        to be able to resume the process if interrupted. The whole process might result in several commits.

        Args:
            repo_id (`str`):
                The repository to which the file will be uploaded.
                E.g. `"HuggingFaceTB/smollm-corpus"`.
            folder_path (`str` or `Path`):
                Path to the folder to upload on the local file system.
            repo_type (`str`):
                Type of the repository. Must be one of `"model"`, `"dataset"` or `"space"`.
                Unlike in all other `HfApi` methods, `repo_type` is explicitly required here. This is to avoid
                any mistake when uploading a large folder to the Hub, and therefore prevent from having to re-upload
                everything.
            revision (`str`, `optional`):
                The branch to commit to. If not provided, the `main` branch will be used.
            private (`bool`, `optional`):
                Whether the repository should be private.
                If `None` (default), the repo will be public unless the organization's default is private.
            allow_patterns (`List[str]` or `str`, *optional*):
                If provided, only files matching at least one pattern are uploaded.
            ignore_patterns (`List[str]` or `str`, *optional*):
                If provided, files matching any of the patterns are not uploaded.
            num_workers (`int`, *optional*):
                Number of workers to start. Defaults to `os.cpu_count() - 2` (minimum 2).
                A higher number of workers may speed up the process if your machine allows it. However, on machines with a
                slower connection, it is recommended to keep the number of workers low to ensure better resumability.
                Indeed, partially uploaded files will have to be completely re-uploaded if the process is interrupted.
            print_report (`bool`, *optional*):
                Whether to print a report of the upload progress. Defaults to True.
                Report is printed to `sys.stdout` every X seconds (60 by defaults) and overwrites the previous report.
            print_report_every (`int`, *optional*):
                Frequency at which the report is printed. Defaults to 60 seconds.

        <Tip>

        A few things to keep in mind:
            - Repository limits still apply: https://huggingface.co/docs/hub/repositories-recommendations
            - Do not start several processes in parallel.
            - You can interrupt and resume the process at any time.
            - Do not upload the same folder to several repositories. If you need to do so, you must delete the local `.cache/.huggingface/` folder first.

        </Tip>

        <Tip warning={true}>

        While being much more robust to upload large folders, `upload_large_folder` is more limited than [`upload_folder`] feature-wise. In practice:
            - you cannot set a custom `path_in_repo`. If you want to upload to a subfolder, you need to set the proper structure locally.
            - you cannot set a custom `commit_message` and `commit_description` since multiple commits are created.
            - you cannot delete from the repo while uploading. Please make a separate commit first.
            - you cannot create a PR directly. Please create a PR first (from the UI or using [`create_pull_request`]) and then commit to it by passing `revision`.

        </Tip>

        **Technical details:**

        `upload_large_folder` process is as follow:
            1. (Check parameters and setup.)
            2. Create repo if missing.
            3. List local files to upload.
            4. Start workers. Workers can perform the following tasks:
                - Hash a file.
                - Get upload mode (regular or LFS) for a list of files.
                - Pre-upload an LFS file.
                - Commit a bunch of files.
            Once a worker finishes a task, it will move on to the next task based on the priority list (see below) until
            all files are uploaded and committed.
            5. While workers are up, regularly print a report to sys.stdout.

        Order of priority:
            1. Commit if more than 5 minutes since last commit attempt (and at least 1 file).
            2. Commit if at least 150 files are ready to commit.
            3. Get upload mode if at least 10 files have been hashed.
            4. Pre-upload LFS file if at least 1 file and no worker is pre-uploading.
            5. Hash file if at least 1 file and no worker is hashing.
            6. Get upload mode if at least 1 file and no worker is getting upload mode.
            7. Pre-upload LFS file if at least 1 file (exception: if hf_transfer is enabled, only 1 worker can preupload LFS at a time).
            8. Hash file if at least 1 file to hash.
            9. Get upload mode if at least 1 file to get upload mode.
            10. Commit if at least 1 file to commit and at least 1 min since last commit attempt.
            11. Commit if at least 1 file to commit and all other queues are empty.

        Special rules:
            - If `hf_transfer` is enabled, only 1 LFS uploader at a time. Otherwise the CPU would be bloated by `hf_transfer`.
            - Only one worker can commit at a time.
            - If no tasks are available, the worker waits for 10 seconds before checking again.
        """
        return upload_large_folder_internal(
            self,
            repo_id=repo_id,
            folder_path=folder_path,
            repo_type=repo_type,
            revision=revision,
            private=private,
            allow_patterns=allow_patterns,
            ignore_patterns=ignore_patterns,
            num_workers=num_workers,
            print_report=print_report,
            print_report_every=print_report_every,
        )

    @validate_hf_hub_args
    def get_hf_file_metadata(
        self,
        *,
        url: str,
        token: Union[bool, str, None] = None,
        proxies: Optional[Dict] = None,
        timeout: Optional[float] = constants.DEFAULT_REQUEST_TIMEOUT,
    ) -> HfFileMetadata:
        """Fetch metadata of a file versioned on the Hub for a given url.

        Args:
            url (`str`):
                File url, for example returned by [`hf_hub_url`].
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            proxies (`dict`, *optional*):
                Dictionary mapping protocol to the URL of the proxy passed to `requests.request`.
            timeout (`float`, *optional*, defaults to 10):
                How many seconds to wait for the server to send metadata before giving up.

        Returns:
            A [`HfFileMetadata`] object containing metadata such as location, etag, size and commit_hash.
        """
        if token is None:
            # Cannot do `token = token or self.token` as token can be `False`.
            token = self.token

        return get_hf_file_metadata(
            url=url,
            token=token,
            proxies=proxies,
            timeout=timeout,
            library_name=self.library_name,
            library_version=self.library_version,
            user_agent=self.user_agent,
        )

    @validate_hf_hub_args
    def hf_hub_download(
        self,
        repo_id: str,
        filename: str,
        *,
        subfolder: Optional[str] = None,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        cache_dir: Union[str, Path, None] = None,
        local_dir: Union[str, Path, None] = None,
        force_download: bool = False,
        proxies: Optional[Dict] = None,
        etag_timeout: float = constants.DEFAULT_ETAG_TIMEOUT,
        token: Union[bool, str, None] = None,
        local_files_only: bool = False,
        # Deprecated args
        resume_download: Optional[bool] = None,
        force_filename: Optional[str] = None,
        local_dir_use_symlinks: Union[bool, Literal["auto"]] = "auto",
    ) -> str:
        """Download a given file if it's not already present in the local cache.

        The new cache file layout looks like this:
        - The cache directory contains one subfolder per repo_id (namespaced by repo type)
        - inside each repo folder:
            - refs is a list of the latest known revision => commit_hash pairs
            - blobs contains the actual file blobs (identified by their git-sha or sha256, depending on
            whether they're LFS files or not)
            - snapshots contains one subfolder per commit, each "commit" contains the subset of the files
            that have been resolved at that particular commit. Each filename is a symlink to the blob
            at that particular commit.

        ```
        [  96]  .
        └── [ 160]  models--julien-c--EsperBERTo-small
            ├── [ 160]  blobs
            │   ├── [321M]  403450e234d65943a7dcf7e05a771ce3c92faa84dd07db4ac20f592037a1e4bd
            │   ├── [ 398]  7cb18dc9bafbfcf74629a4b760af1b160957a83e
            │   └── [1.4K]  d7edf6bd2a681fb0175f7735299831ee1b22b812
            ├── [  96]  refs
            │   └── [  40]  main
            └── [ 128]  snapshots
                ├── [ 128]  2439f60ef33a0d46d85da5001d52aeda5b00ce9f
                │   ├── [  52]  README.md -> ../../blobs/d7edf6bd2a681fb0175f7735299831ee1b22b812
                │   └── [  76]  pytorch_model.bin -> ../../blobs/403450e234d65943a7dcf7e05a771ce3c92faa84dd07db4ac20f592037a1e4bd
                └── [ 128]  bbc77c8132af1cc5cf678da3f1ddf2de43606d48
                    ├── [  52]  README.md -> ../../blobs/7cb18dc9bafbfcf74629a4b760af1b160957a83e
                    └── [  76]  pytorch_model.bin -> ../../blobs/403450e234d65943a7dcf7e05a771ce3c92faa84dd07db4ac20f592037a1e4bd
        ```

        If `local_dir` is provided, the file structure from the repo will be replicated in this location. When using this
        option, the `cache_dir` will not be used and a `.cache/huggingface/` folder will be created at the root of `local_dir`
        to store some metadata related to the downloaded files. While this mechanism is not as robust as the main
        cache-system, it's optimized for regularly pulling the latest version of a repository.

        Args:
            repo_id (`str`):
                A user or an organization name and a repo name separated by a `/`.
            filename (`str`):
                The name of the file in the repo.
            subfolder (`str`, *optional*):
                An optional value corresponding to a folder inside the repository.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if downloading from a dataset or space,
                `None` or `"model"` if downloading from a model. Default is `None`.
            revision (`str`, *optional*):
                An optional Git revision id which can be a branch name, a tag, or a
                commit hash.
            cache_dir (`str`, `Path`, *optional*):
                Path to the folder where cached files are stored.
            local_dir (`str` or `Path`, *optional*):
                If provided, the downloaded file will be placed under this directory.
            force_download (`bool`, *optional*, defaults to `False`):
                Whether the file should be downloaded even if it already exists in
                the local cache.
            proxies (`dict`, *optional*):
                Dictionary mapping protocol to the URL of the proxy passed to
                `requests.request`.
            etag_timeout (`float`, *optional*, defaults to `10`):
                When fetching ETag, how many seconds to wait for the server to send
                data before giving up which is passed to `requests.request`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            local_files_only (`bool`, *optional*, defaults to `False`):
                If `True`, avoid downloading the file and return the path to the
                local cached file if it exists.

        Returns:
            `str`: Local path of file or if networking is off, last version of file cached on disk.

        Raises:
            [`~utils.RepositoryNotFoundError`]
                If the repository to download from cannot be found. This may be because it doesn't exist,
                or because it is set to `private` and you do not have access.
            [`~utils.RevisionNotFoundError`]
                If the revision to download from cannot be found.
            [`~utils.EntryNotFoundError`]
                If the file to download cannot be found.
            [`~utils.LocalEntryNotFoundError`]
                If network is disabled or unavailable and file is not found in cache.
            [`EnvironmentError`](https://docs.python.org/3/library/exceptions.html#EnvironmentError)
                If `token=True` but the token cannot be found.
            [`OSError`](https://docs.python.org/3/library/exceptions.html#OSError)
                If ETag cannot be determined.
            [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
                If some parameter value is invalid.
        """
        from .file_download import hf_hub_download

        if token is None:
            # Cannot do `token = token or self.token` as token can be `False`.
            token = self.token

        return hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            subfolder=subfolder,
            repo_type=repo_type,
            revision=revision,
            endpoint=self.endpoint,
            library_name=self.library_name,
            library_version=self.library_version,
            cache_dir=cache_dir,
            local_dir=local_dir,
            local_dir_use_symlinks=local_dir_use_symlinks,
            user_agent=self.user_agent,
            force_download=force_download,
            force_filename=force_filename,
            proxies=proxies,
            etag_timeout=etag_timeout,
            resume_download=resume_download,
            token=token,
            headers=self.headers,
            local_files_only=local_files_only,
        )

    @validate_hf_hub_args
    def snapshot_download(
        self,
        repo_id: str,
        *,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        cache_dir: Union[str, Path, None] = None,
        local_dir: Union[str, Path, None] = None,
        proxies: Optional[Dict] = None,
        etag_timeout: float = constants.DEFAULT_ETAG_TIMEOUT,
        force_download: bool = False,
        token: Union[bool, str, None] = None,
        local_files_only: bool = False,
        allow_patterns: Optional[Union[List[str], str]] = None,
        ignore_patterns: Optional[Union[List[str], str]] = None,
        max_workers: int = 8,
        tqdm_class: Optional[Type[base_tqdm]] = None,
        # Deprecated args
        local_dir_use_symlinks: Union[bool, Literal["auto"]] = "auto",
        resume_download: Optional[bool] = None,
    ) -> str:
        """Download repo files.

        Download a whole snapshot of a repo's files at the specified revision. This is useful when you want all files from
        a repo, because you don't know which ones you will need a priori. All files are nested inside a folder in order
        to keep their actual filename relative to that folder. You can also filter which files to download using
        `allow_patterns` and `ignore_patterns`.

        If `local_dir` is provided, the file structure from the repo will be replicated in this location. When using this
        option, the `cache_dir` will not be used and a `.cache/huggingface/` folder will be created at the root of `local_dir`
        to store some metadata related to the downloaded files.While this mechanism is not as robust as the main
        cache-system, it's optimized for regularly pulling the latest version of a repository.

        An alternative would be to clone the repo but this requires git and git-lfs to be installed and properly
        configured. It is also not possible to filter which files to download when cloning a repository using git.

        Args:
            repo_id (`str`):
                A user or an organization name and a repo name separated by a `/`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if downloading from a dataset or space,
                `None` or `"model"` if downloading from a model. Default is `None`.
            revision (`str`, *optional*):
                An optional Git revision id which can be a branch name, a tag, or a
                commit hash.
            cache_dir (`str`, `Path`, *optional*):
                Path to the folder where cached files are stored.
            local_dir (`str` or `Path`, *optional*):
                If provided, the downloaded files will be placed under this directory.
            proxies (`dict`, *optional*):
                Dictionary mapping protocol to the URL of the proxy passed to
                `requests.request`.
            etag_timeout (`float`, *optional*, defaults to `10`):
                When fetching ETag, how many seconds to wait for the server to send
                data before giving up which is passed to `requests.request`.
            force_download (`bool`, *optional*, defaults to `False`):
                Whether the file should be downloaded even if it already exists in the local cache.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            local_files_only (`bool`, *optional*, defaults to `False`):
                If `True`, avoid downloading the file and return the path to the
                local cached file if it exists.
            allow_patterns (`List[str]` or `str`, *optional*):
                If provided, only files matching at least one pattern are downloaded.
            ignore_patterns (`List[str]` or `str`, *optional*):
                If provided, files matching any of the patterns are not downloaded.
            max_workers (`int`, *optional*):
                Number of concurrent threads to download files (1 thread = 1 file download).
                Defaults to 8.
            tqdm_class (`tqdm`, *optional*):
                If provided, overwrites the default behavior for the progress bar. Passed
                argument must inherit from `tqdm.auto.tqdm` or at least mimic its behavior.
                Note that the `tqdm_class` is not passed to each individual download.
                Defaults to the custom HF progress bar that can be disabled by setting
                `HF_HUB_DISABLE_PROGRESS_BARS` environment variable.

        Returns:
            `str`: folder path of the repo snapshot.

        Raises:
            [`~utils.RepositoryNotFoundError`]
                If the repository to download from cannot be found. This may be because it doesn't exist,
                or because it is set to `private` and you do not have access.
            [`~utils.RevisionNotFoundError`]
                If the revision to download from cannot be found.
            [`EnvironmentError`](https://docs.python.org/3/library/exceptions.html#EnvironmentError)
                If `token=True` and the token cannot be found.
            [`OSError`](https://docs.python.org/3/library/exceptions.html#OSError) if
                ETag cannot be determined.
            [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
                if some parameter value is invalid.
        """
        from ._snapshot_download import snapshot_download

        if token is None:
            # Cannot do `token = token or self.token` as token can be `False`.
            token = self.token

        return snapshot_download(
            repo_id=repo_id,
            repo_type=repo_type,
            revision=revision,
            endpoint=self.endpoint,
            cache_dir=cache_dir,
            local_dir=local_dir,
            local_dir_use_symlinks=local_dir_use_symlinks,
            library_name=self.library_name,
            library_version=self.library_version,
            user_agent=self.user_agent,
            proxies=proxies,
            etag_timeout=etag_timeout,
            resume_download=resume_download,
            force_download=force_download,
            token=token,
            local_files_only=local_files_only,
            allow_patterns=allow_patterns,
            ignore_patterns=ignore_patterns,
            max_workers=max_workers,
            tqdm_class=tqdm_class,
        )

    def get_safetensors_metadata(
        self,
        repo_id: str,
        *,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> SafetensorsRepoMetadata:
        """
        Parse metadata for a safetensors repo on the Hub.

        We first check if the repo has a single safetensors file or a sharded safetensors repo. If it's a single
        safetensors file, we parse the metadata from this file. If it's a sharded safetensors repo, we parse the
        metadata from the index file and then parse the metadata from each shard.

        To parse metadata from a single safetensors file, use [`parse_safetensors_file_metadata`].

        For more details regarding the safetensors format, check out https://huggingface.co/docs/safetensors/index#format.

        Args:
            repo_id (`str`):
                A user or an organization name and a repo name separated by a `/`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if the file is in a dataset or space, `None` or `"model"` if in a
                model. Default is `None`.
            revision (`str`, *optional*):
                The git revision to fetch the file from. Can be a branch name, a tag, or a commit hash. Defaults to the
                head of the `"main"` branch.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`SafetensorsRepoMetadata`]: information related to safetensors repo.

        Raises:
            [`NotASafetensorsRepoError`]
                If the repo is not a safetensors repo i.e. doesn't have either a
              `model.safetensors` or a `model.safetensors.index.json` file.
            [`SafetensorsParsingError`]
                If a safetensors file header couldn't be parsed correctly.

        Example:
            ```py
            # Parse repo with single weights file
            >>> metadata = get_safetensors_metadata("bigscience/bloomz-560m")
            >>> metadata
            SafetensorsRepoMetadata(
                metadata=None,
                sharded=False,
                weight_map={'h.0.input_layernorm.bias': 'model.safetensors', ...},
                files_metadata={'model.safetensors': SafetensorsFileMetadata(...)}
            )
            >>> metadata.files_metadata["model.safetensors"].metadata
            {'format': 'pt'}

            # Parse repo with sharded model
            >>> metadata = get_safetensors_metadata("bigscience/bloom")
            Parse safetensors files: 100%|██████████████████████████████████████████| 72/72 [00:12<00:00,  5.78it/s]
            >>> metadata
            SafetensorsRepoMetadata(metadata={'total_size': 352494542848}, sharded=True, weight_map={...}, files_metadata={...})
            >>> len(metadata.files_metadata)
            72  # All safetensors files have been fetched

            # Parse repo with sharded model
            >>> get_safetensors_metadata("runwayml/stable-diffusion-v1-5")
            NotASafetensorsRepoError: 'runwayml/stable-diffusion-v1-5' is not a safetensors repo. Couldn't find 'model.safetensors.index.json' or 'model.safetensors' files.
            ```
        """
        if self.file_exists(  # Single safetensors file => non-sharded model
            repo_id=repo_id,
            filename=constants.SAFETENSORS_SINGLE_FILE,
            repo_type=repo_type,
            revision=revision,
            token=token,
        ):
            file_metadata = self.parse_safetensors_file_metadata(
                repo_id=repo_id,
                filename=constants.SAFETENSORS_SINGLE_FILE,
                repo_type=repo_type,
                revision=revision,
                token=token,
            )
            return SafetensorsRepoMetadata(
                metadata=None,
                sharded=False,
                weight_map={
                    tensor_name: constants.SAFETENSORS_SINGLE_FILE for tensor_name in file_metadata.tensors.keys()
                },
                files_metadata={constants.SAFETENSORS_SINGLE_FILE: file_metadata},
            )
        elif self.file_exists(  # Multiple safetensors files => sharded with index
            repo_id=repo_id,
            filename=constants.SAFETENSORS_INDEX_FILE,
            repo_type=repo_type,
            revision=revision,
            token=token,
        ):
            # Fetch index
            index_file = self.hf_hub_download(
                repo_id=repo_id,
                filename=constants.SAFETENSORS_INDEX_FILE,
                repo_type=repo_type,
                revision=revision,
                token=token,
            )
            with open(index_file) as f:
                index = json.load(f)

            weight_map = index.get("weight_map", {})

            # Fetch metadata per shard
            files_metadata = {}

            def _parse(filename: str) -> None:
                files_metadata[filename] = self.parse_safetensors_file_metadata(
                    repo_id=repo_id, filename=filename, repo_type=repo_type, revision=revision, token=token
                )

            thread_map(
                _parse,
                set(weight_map.values()),
                desc="Parse safetensors files",
                tqdm_class=hf_tqdm,
            )

            return SafetensorsRepoMetadata(
                metadata=index.get("metadata", None),
                sharded=True,
                weight_map=weight_map,
                files_metadata=files_metadata,
            )
        else:
            # Not a safetensors repo
            raise NotASafetensorsRepoError(
                f"'{repo_id}' is not a safetensors repo. Couldn't find '{constants.SAFETENSORS_INDEX_FILE}' or '{constants.SAFETENSORS_SINGLE_FILE}' files."
            )

    def parse_safetensors_file_metadata(
        self,
        repo_id: str,
        filename: str,
        *,
        repo_type: Optional[str] = None,
        revision: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> SafetensorsFileMetadata:
        """
        Parse metadata from a safetensors file on the Hub.

        To parse metadata from all safetensors files in a repo at once, use [`get_safetensors_metadata`].

        For more details regarding the safetensors format, check out https://huggingface.co/docs/safetensors/index#format.

        Args:
            repo_id (`str`):
                A user or an organization name and a repo name separated by a `/`.
            filename (`str`):
                The name of the file in the repo.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if the file is in a dataset or space, `None` or `"model"` if in a
                model. Default is `None`.
            revision (`str`, *optional*):
                The git revision to fetch the file from. Can be a branch name, a tag, or a commit hash. Defaults to the
                head of the `"main"` branch.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`SafetensorsFileMetadata`]: information related to a safetensors file.

        Raises:
            [`NotASafetensorsRepoError`]:
                If the repo is not a safetensors repo i.e. doesn't have either a
              `model.safetensors` or a `model.safetensors.index.json` file.
            [`SafetensorsParsingError`]:
                If a safetensors file header couldn't be parsed correctly.
        """
        url = hf_hub_url(
            repo_id=repo_id, filename=filename, repo_type=repo_type, revision=revision, endpoint=self.endpoint
        )
        _headers = self._build_hf_headers(token=token)

        # 1. Fetch first 100kb
        # Empirically, 97% of safetensors files have a metadata size < 100kb (over the top 1000 models on the Hub).
        # We assume fetching 100kb is faster than making 2 GET requests. Therefore we always fetch the first 100kb to
        # avoid the 2nd GET in most cases.
        # See https://github.com/huggingface/huggingface_hub/pull/1855#discussion_r1404286419.
        response = get_session().get(url, headers={**_headers, "range": "bytes=0-100000"})
        hf_raise_for_status(response)

        # 2. Parse metadata size
        metadata_size = struct.unpack("<Q", response.content[:8])[0]
        if metadata_size > constants.SAFETENSORS_MAX_HEADER_LENGTH:
            raise SafetensorsParsingError(
                f"Failed to parse safetensors header for '{filename}' (repo '{repo_id}', revision "
                f"'{revision or constants.DEFAULT_REVISION}'): safetensors header is too big. Maximum supported size is "
                f"{constants.SAFETENSORS_MAX_HEADER_LENGTH} bytes (got {metadata_size})."
            )

        # 3.a. Get metadata from payload
        if metadata_size <= 100000:
            metadata_as_bytes = response.content[8 : 8 + metadata_size]
        else:  # 3.b. Request full metadata
            response = get_session().get(url, headers={**_headers, "range": f"bytes=8-{metadata_size + 7}"})
            hf_raise_for_status(response)
            metadata_as_bytes = response.content

        # 4. Parse json header
        try:
            metadata_as_dict = json.loads(metadata_as_bytes.decode(errors="ignore"))
        except json.JSONDecodeError as e:
            raise SafetensorsParsingError(
                f"Failed to parse safetensors header for '{filename}' (repo '{repo_id}', revision "
                f"'{revision or constants.DEFAULT_REVISION}'): header is not json-encoded string. Please make sure this is a "
                "correctly formatted safetensors file."
            ) from e

        try:
            return SafetensorsFileMetadata(
                metadata=metadata_as_dict.get("__metadata__", {}),
                tensors={
                    key: TensorInfo(
                        dtype=tensor["dtype"],
                        shape=tensor["shape"],
                        data_offsets=tuple(tensor["data_offsets"]),  # type: ignore
                    )
                    for key, tensor in metadata_as_dict.items()
                    if key != "__metadata__"
                },
            )
        except (KeyError, IndexError) as e:
            raise SafetensorsParsingError(
                f"Failed to parse safetensors header for '{filename}' (repo '{repo_id}', revision "
                f"'{revision or constants.DEFAULT_REVISION}'): header format not recognized. Please make sure this is a correctly"
                " formatted safetensors file."
            ) from e

    @validate_hf_hub_args
    def create_branch(
        self,
        repo_id: str,
        *,
        branch: str,
        revision: Optional[str] = None,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
        exist_ok: bool = False,
    ) -> None:
        """
        Create a new branch for a repo on the Hub, starting from the specified revision (defaults to `main`).
        To find a revision suiting your needs, you can use [`list_repo_refs`] or [`list_repo_commits`].

        Args:
            repo_id (`str`):
                The repository in which the branch will be created.
                Example: `"user/my-cool-model"`.

            branch (`str`):
                The name of the branch to create.

            revision (`str`, *optional*):
                The git revision to create the branch from. It can be a branch name or
                the OID/SHA of a commit, as a hexadecimal string. Defaults to the head
                of the `"main"` branch.

            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if creating a branch on a dataset or
                space, `None` or `"model"` if tagging a model. Default is `None`.

            exist_ok (`bool`, *optional*, defaults to `False`):
                If `True`, do not raise an error if branch already exists.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private
                but not authenticated or repo does not exist.
            [`~utils.BadRequestError`]:
                If invalid reference for a branch. Ex: `refs/pr/5` or 'refs/foo/bar'.
            [`~utils.HfHubHTTPError`]:
                If the branch already exists on the repo (error 409) and `exist_ok` is
                set to `False`.
        """
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        branch = quote(branch, safe="")

        # Prepare request
        branch_url = f"{self.endpoint}/api/{repo_type}s/{repo_id}/branch/{branch}"
        headers = self._build_hf_headers(token=token)
        payload = {}
        if revision is not None:
            payload["startingPoint"] = revision

        # Create branch
        response = get_session().post(url=branch_url, headers=headers, json=payload)
        try:
            hf_raise_for_status(response)
        except HfHubHTTPError as e:
            if exist_ok and e.response.status_code == 409:
                return
            elif exist_ok and e.response.status_code == 403:
                # No write permission on the namespace but branch might already exist
                try:
                    refs = self.list_repo_refs(repo_id=repo_id, repo_type=repo_type, token=token)
                    for branch_ref in refs.branches:
                        if branch_ref.name == branch:
                            return  # Branch already exists => do not raise
                except HfHubHTTPError:
                    pass  # We raise the original error if the branch does not exist
            raise

    @validate_hf_hub_args
    def delete_branch(
        self,
        repo_id: str,
        *,
        branch: str,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
    ) -> None:
        """
        Delete a branch from a repo on the Hub.

        Args:
            repo_id (`str`):
                The repository in which a branch will be deleted.
                Example: `"user/my-cool-model"`.

            branch (`str`):
                The name of the branch to delete.

            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if creating a branch on a dataset or
                space, `None` or `"model"` if tagging a model. Default is `None`.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private
                but not authenticated or repo does not exist.
            [`~utils.HfHubHTTPError`]:
                If trying to delete a protected branch. Ex: `main` cannot be deleted.
            [`~utils.HfHubHTTPError`]:
                If trying to delete a branch that does not exist.

        """
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        branch = quote(branch, safe="")

        # Prepare request
        branch_url = f"{self.endpoint}/api/{repo_type}s/{repo_id}/branch/{branch}"
        headers = self._build_hf_headers(token=token)

        # Delete branch
        response = get_session().delete(url=branch_url, headers=headers)
        hf_raise_for_status(response)

    @validate_hf_hub_args
    def create_tag(
        self,
        repo_id: str,
        *,
        tag: str,
        tag_message: Optional[str] = None,
        revision: Optional[str] = None,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
        exist_ok: bool = False,
    ) -> None:
        """
        Tag a given commit of a repo on the Hub.

        Args:
            repo_id (`str`):
                The repository in which a commit will be tagged.
                Example: `"user/my-cool-model"`.

            tag (`str`):
                The name of the tag to create.

            tag_message (`str`, *optional*):
                The description of the tag to create.

            revision (`str`, *optional*):
                The git revision to tag. It can be a branch name or the OID/SHA of a
                commit, as a hexadecimal string. Shorthands (7 first characters) are
                also supported. Defaults to the head of the `"main"` branch.

            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if tagging a dataset or
                space, `None` or `"model"` if tagging a model. Default is
                `None`.

            exist_ok (`bool`, *optional*, defaults to `False`):
                If `True`, do not raise an error if tag already exists.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private
                but not authenticated or repo does not exist.
            [`~utils.RevisionNotFoundError`]:
                If revision is not found (error 404) on the repo.
            [`~utils.HfHubHTTPError`]:
                If the branch already exists on the repo (error 409) and `exist_ok` is
                set to `False`.
        """
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        revision = quote(revision, safe="") if revision is not None else constants.DEFAULT_REVISION

        # Prepare request
        tag_url = f"{self.endpoint}/api/{repo_type}s/{repo_id}/tag/{revision}"
        headers = self._build_hf_headers(token=token)
        payload = {"tag": tag}
        if tag_message is not None:
            payload["message"] = tag_message

        # Tag
        response = get_session().post(url=tag_url, headers=headers, json=payload)
        try:
            hf_raise_for_status(response)
        except HfHubHTTPError as e:
            if not (e.response.status_code == 409 and exist_ok):
                raise

    @validate_hf_hub_args
    def delete_tag(
        self,
        repo_id: str,
        *,
        tag: str,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
    ) -> None:
        """
        Delete a tag from a repo on the Hub.

        Args:
            repo_id (`str`):
                The repository in which a tag will be deleted.
                Example: `"user/my-cool-model"`.

            tag (`str`):
                The name of the tag to delete.

            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if tagging a dataset or space, `None` or
                `"model"` if tagging a model. Default is `None`.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If repository is not found (error 404): wrong repo_id/repo_type, private
                but not authenticated or repo does not exist.
            [`~utils.RevisionNotFoundError`]:
                If tag is not found.
        """
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        tag = quote(tag, safe="")

        # Prepare request
        tag_url = f"{self.endpoint}/api/{repo_type}s/{repo_id}/tag/{tag}"
        headers = self._build_hf_headers(token=token)

        # Un-tag
        response = get_session().delete(url=tag_url, headers=headers)
        hf_raise_for_status(response)

    @validate_hf_hub_args
    def get_full_repo_name(
        self,
        model_id: str,
        *,
        organization: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ):
        """
        Returns the repository name for a given model ID and optional
        organization.

        Args:
            model_id (`str`):
                The name of the model.
            organization (`str`, *optional*):
                If passed, the repository name will be in the organization
                namespace instead of the user namespace.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `str`: The repository name in the user's namespace
            ({username}/{model_id}) if no organization is passed, and under the
            organization namespace ({organization}/{model_id}) otherwise.
        """
        if organization is None:
            if "/" in model_id:
                username = model_id.split("/")[0]
            else:
                username = self.whoami(token=token)["name"]  # type: ignore
            return f"{username}/{model_id}"
        else:
            return f"{organization}/{model_id}"

    @validate_hf_hub_args
    def get_repo_discussions(
        self,
        repo_id: str,
        *,
        author: Optional[str] = None,
        discussion_type: Optional[constants.DiscussionTypeFilter] = None,
        discussion_status: Optional[constants.DiscussionStatusFilter] = None,
        repo_type: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> Iterator[Discussion]:
        """
        Fetches Discussions and Pull Requests for the given repo.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            author (`str`, *optional*):
                Pass a value to filter by discussion author. `None` means no filter.
                Default is `None`.
            discussion_type (`str`, *optional*):
                Set to `"pull_request"` to fetch only pull requests, `"discussion"`
                to fetch only discussions. Set to `"all"` or `None` to fetch both.
                Default is `None`.
            discussion_status (`str`, *optional*):
                Set to `"open"` (respectively `"closed"`) to fetch only open
                (respectively closed) discussions. Set to `"all"` or `None`
                to fetch both.
                Default is `None`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if fetching from a dataset or
                space, `None` or `"model"` if fetching from a model. Default is
                `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterator[Discussion]`: An iterator of [`Discussion`] objects.

        Example:
            Collecting all discussions of a repo in a list:

            ```python
            >>> from huggingface_hub import get_repo_discussions
            >>> discussions_list = list(get_repo_discussions(repo_id="bert-base-uncased"))
            ```

            Iterating over discussions of a repo:

            ```python
            >>> from huggingface_hub import get_repo_discussions
            >>> for discussion in get_repo_discussions(repo_id="bert-base-uncased"):
            ...     print(discussion.num, discussion.title)
            ```
        """
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        if discussion_type is not None and discussion_type not in constants.DISCUSSION_TYPES:
            raise ValueError(f"Invalid discussion_type, must be one of {constants.DISCUSSION_TYPES}")
        if discussion_status is not None and discussion_status not in constants.DISCUSSION_STATUS:
            raise ValueError(f"Invalid discussion_status, must be one of {constants.DISCUSSION_STATUS}")

        headers = self._build_hf_headers(token=token)
        path = f"{self.endpoint}/api/{repo_type}s/{repo_id}/discussions"

        params: Dict[str, Union[str, int]] = {}
        if discussion_type is not None:
            params["type"] = discussion_type
        if discussion_status is not None:
            params["status"] = discussion_status
        if author is not None:
            params["author"] = author

        def _fetch_discussion_page(page_index: int):
            params["p"] = page_index
            resp = get_session().get(path, headers=headers, params=params)
            hf_raise_for_status(resp)
            paginated_discussions = resp.json()
            total = paginated_discussions["count"]
            start = paginated_discussions["start"]
            discussions = paginated_discussions["discussions"]
            has_next = (start + len(discussions)) < total
            return discussions, has_next

        has_next, page_index = True, 0

        while has_next:
            discussions, has_next = _fetch_discussion_page(page_index=page_index)
            for discussion in discussions:
                yield Discussion(
                    title=discussion["title"],
                    num=discussion["num"],
                    author=discussion.get("author", {}).get("name", "deleted"),
                    created_at=parse_datetime(discussion["createdAt"]),
                    status=discussion["status"],
                    repo_id=discussion["repo"]["name"],
                    repo_type=discussion["repo"]["type"],
                    is_pull_request=discussion["isPullRequest"],
                    endpoint=self.endpoint,
                )
            page_index = page_index + 1

    @validate_hf_hub_args
    def get_discussion_details(
        self,
        repo_id: str,
        discussion_num: int,
        *,
        repo_type: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> DiscussionWithDetails:
        """Fetches a Discussion's / Pull Request 's details from the Hub.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            discussion_num (`int`):
                The number of the Discussion or Pull Request . Must be a strictly positive integer.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns: [`DiscussionWithDetails`]

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>
        """
        if not isinstance(discussion_num, int) or discussion_num <= 0:
            raise ValueError("Invalid discussion_num, must be a positive integer")
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL

        path = f"{self.endpoint}/api/{repo_type}s/{repo_id}/discussions/{discussion_num}"
        headers = self._build_hf_headers(token=token)
        resp = get_session().get(path, params={"diff": "1"}, headers=headers)
        hf_raise_for_status(resp)

        discussion_details = resp.json()
        is_pull_request = discussion_details["isPullRequest"]

        target_branch = discussion_details["changes"]["base"] if is_pull_request else None
        conflicting_files = discussion_details["filesWithConflicts"] if is_pull_request else None
        merge_commit_oid = discussion_details["changes"].get("mergeCommitId", None) if is_pull_request else None

        return DiscussionWithDetails(
            title=discussion_details["title"],
            num=discussion_details["num"],
            author=discussion_details.get("author", {}).get("name", "deleted"),
            created_at=parse_datetime(discussion_details["createdAt"]),
            status=discussion_details["status"],
            repo_id=discussion_details["repo"]["name"],
            repo_type=discussion_details["repo"]["type"],
            is_pull_request=discussion_details["isPullRequest"],
            events=[deserialize_event(evt) for evt in discussion_details["events"]],
            conflicting_files=conflicting_files,
            target_branch=target_branch,
            merge_commit_oid=merge_commit_oid,
            diff=discussion_details.get("diff"),
            endpoint=self.endpoint,
        )

    @validate_hf_hub_args
    def create_discussion(
        self,
        repo_id: str,
        title: str,
        *,
        token: Union[bool, str, None] = None,
        description: Optional[str] = None,
        repo_type: Optional[str] = None,
        pull_request: bool = False,
    ) -> DiscussionWithDetails:
        """Creates a Discussion or Pull Request.

        Pull Requests created programmatically will be in `"draft"` status.

        Creating a Pull Request with changes can also be done at once with [`HfApi.create_commit`].

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            title (`str`):
                The title of the discussion. It can be up to 200 characters long,
                and must be at least 3 characters long. Leading and trailing whitespaces
                will be stripped.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            description (`str`, *optional*):
                An optional description for the Pull Request.
                Defaults to `"Discussion opened with the huggingface_hub Python library"`
            pull_request (`bool`, *optional*):
                Whether to create a Pull Request or discussion. If `True`, creates a Pull Request.
                If `False`, creates a discussion. Defaults to `False`.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.

        Returns: [`DiscussionWithDetails`]

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>"""
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL

        if description is not None:
            description = description.strip()
        description = (
            description
            if description
            else (
                f"{'Pull Request' if pull_request else 'Discussion'} opened with the"
                " [huggingface_hub Python"
                " library](https://huggingface.co/docs/huggingface_hub)"
            )
        )

        headers = self._build_hf_headers(token=token)
        resp = get_session().post(
            f"{self.endpoint}/api/{repo_type}s/{repo_id}/discussions",
            json={
                "title": title.strip(),
                "description": description,
                "pullRequest": pull_request,
            },
            headers=headers,
        )
        hf_raise_for_status(resp)
        num = resp.json()["num"]
        return self.get_discussion_details(
            repo_id=repo_id,
            repo_type=repo_type,
            discussion_num=num,
            token=token,
        )

    @validate_hf_hub_args
    def create_pull_request(
        self,
        repo_id: str,
        title: str,
        *,
        token: Union[bool, str, None] = None,
        description: Optional[str] = None,
        repo_type: Optional[str] = None,
    ) -> DiscussionWithDetails:
        """Creates a Pull Request . Pull Requests created programmatically will be in `"draft"` status.

        Creating a Pull Request with changes can also be done at once with [`HfApi.create_commit`];

        This is a wrapper around [`HfApi.create_discussion`].

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            title (`str`):
                The title of the discussion. It can be up to 200 characters long,
                and must be at least 3 characters long. Leading and trailing whitespaces
                will be stripped.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            description (`str`, *optional*):
                An optional description for the Pull Request.
                Defaults to `"Discussion opened with the huggingface_hub Python library"`
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.

        Returns: [`DiscussionWithDetails`]

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>"""
        return self.create_discussion(
            repo_id=repo_id,
            title=title,
            token=token,
            description=description,
            repo_type=repo_type,
            pull_request=True,
        )

    def _post_discussion_changes(
        self,
        *,
        repo_id: str,
        discussion_num: int,
        resource: str,
        body: Optional[dict] = None,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
    ) -> requests.Response:
        """Internal utility to POST changes to a Discussion or Pull Request"""
        if not isinstance(discussion_num, int) or discussion_num <= 0:
            raise ValueError("Invalid discussion_num, must be a positive integer")
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        repo_id = f"{repo_type}s/{repo_id}"

        path = f"{self.endpoint}/api/{repo_id}/discussions/{discussion_num}/{resource}"

        headers = self._build_hf_headers(token=token)
        resp = requests.post(path, headers=headers, json=body)
        hf_raise_for_status(resp)
        return resp

    @validate_hf_hub_args
    def comment_discussion(
        self,
        repo_id: str,
        discussion_num: int,
        comment: str,
        *,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
    ) -> DiscussionComment:
        """Creates a new comment on the given Discussion.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            discussion_num (`int`):
                The number of the Discussion or Pull Request . Must be a strictly positive integer.
            comment (`str`):
                The content of the comment to create. Comments support markdown formatting.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`DiscussionComment`]: the newly created comment


        Examples:
            ```python

            >>> comment = \"\"\"
            ... Hello @otheruser!
            ...
            ... # This is a title
            ...
            ... **This is bold**, *this is italic* and ~this is strikethrough~
            ... And [this](http://url) is a link
            ... \"\"\"

            >>> HfApi().comment_discussion(
            ...     repo_id="username/repo_name",
            ...     discussion_num=34
            ...     comment=comment
            ... )
            # DiscussionComment(id='deadbeef0000000', type='comment', ...)

            ```

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>
        """
        resp = self._post_discussion_changes(
            repo_id=repo_id,
            repo_type=repo_type,
            discussion_num=discussion_num,
            token=token,
            resource="comment",
            body={"comment": comment},
        )
        return deserialize_event(resp.json()["newMessage"])  # type: ignore

    @validate_hf_hub_args
    def rename_discussion(
        self,
        repo_id: str,
        discussion_num: int,
        new_title: str,
        *,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
    ) -> DiscussionTitleChange:
        """Renames a Discussion.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            discussion_num (`int`):
                The number of the Discussion or Pull Request . Must be a strictly positive integer.
            new_title (`str`):
                The new title for the discussion
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`DiscussionTitleChange`]: the title change event


        Examples:
            ```python
            >>> new_title = "New title, fixing a typo"
            >>> HfApi().rename_discussion(
            ...     repo_id="username/repo_name",
            ...     discussion_num=34
            ...     new_title=new_title
            ... )
            # DiscussionTitleChange(id='deadbeef0000000', type='title-change', ...)

            ```

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>
        """
        resp = self._post_discussion_changes(
            repo_id=repo_id,
            repo_type=repo_type,
            discussion_num=discussion_num,
            token=token,
            resource="title",
            body={"title": new_title},
        )
        return deserialize_event(resp.json()["newTitle"])  # type: ignore

    @validate_hf_hub_args
    def change_discussion_status(
        self,
        repo_id: str,
        discussion_num: int,
        new_status: Literal["open", "closed"],
        *,
        token: Union[bool, str, None] = None,
        comment: Optional[str] = None,
        repo_type: Optional[str] = None,
    ) -> DiscussionStatusChange:
        """Closes or re-opens a Discussion or Pull Request.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            discussion_num (`int`):
                The number of the Discussion or Pull Request . Must be a strictly positive integer.
            new_status (`str`):
                The new status for the discussion, either `"open"` or `"closed"`.
            comment (`str`, *optional*):
                An optional comment to post with the status change.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`DiscussionStatusChange`]: the status change event


        Examples:
            ```python
            >>> new_title = "New title, fixing a typo"
            >>> HfApi().rename_discussion(
            ...     repo_id="username/repo_name",
            ...     discussion_num=34
            ...     new_title=new_title
            ... )
            # DiscussionStatusChange(id='deadbeef0000000', type='status-change', ...)

            ```

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>
        """
        if new_status not in ["open", "closed"]:
            raise ValueError("Invalid status, valid statuses are: 'open' and 'closed'")
        body: Dict[str, str] = {"status": new_status}
        if comment and comment.strip():
            body["comment"] = comment.strip()
        resp = self._post_discussion_changes(
            repo_id=repo_id,
            repo_type=repo_type,
            discussion_num=discussion_num,
            token=token,
            resource="status",
            body=body,
        )
        return deserialize_event(resp.json()["newStatus"])  # type: ignore

    @validate_hf_hub_args
    def merge_pull_request(
        self,
        repo_id: str,
        discussion_num: int,
        *,
        token: Union[bool, str, None] = None,
        comment: Optional[str] = None,
        repo_type: Optional[str] = None,
    ):
        """Merges a Pull Request.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            discussion_num (`int`):
                The number of the Discussion or Pull Request . Must be a strictly positive integer.
            comment (`str`, *optional*):
                An optional comment to post with the status change.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`DiscussionStatusChange`]: the status change event

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>
        """
        self._post_discussion_changes(
            repo_id=repo_id,
            repo_type=repo_type,
            discussion_num=discussion_num,
            token=token,
            resource="merge",
            body={"comment": comment.strip()} if comment and comment.strip() else None,
        )

    @validate_hf_hub_args
    def edit_discussion_comment(
        self,
        repo_id: str,
        discussion_num: int,
        comment_id: str,
        new_content: str,
        *,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
    ) -> DiscussionComment:
        """Edits a comment on a Discussion / Pull Request.

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            discussion_num (`int`):
                The number of the Discussion or Pull Request . Must be a strictly positive integer.
            comment_id (`str`):
                The ID of the comment to edit.
            new_content (`str`):
                The new content of the comment. Comments support markdown formatting.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`DiscussionComment`]: the edited comment

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>
        """
        resp = self._post_discussion_changes(
            repo_id=repo_id,
            repo_type=repo_type,
            discussion_num=discussion_num,
            token=token,
            resource=f"comment/{comment_id.lower()}/edit",
            body={"content": new_content},
        )
        return deserialize_event(resp.json()["updatedComment"])  # type: ignore

    @validate_hf_hub_args
    def hide_discussion_comment(
        self,
        repo_id: str,
        discussion_num: int,
        comment_id: str,
        *,
        token: Union[bool, str, None] = None,
        repo_type: Optional[str] = None,
    ) -> DiscussionComment:
        """Hides a comment on a Discussion / Pull Request.

        <Tip warning={true}>
        Hidden comments' content cannot be retrieved anymore. Hiding a comment is irreversible.
        </Tip>

        Args:
            repo_id (`str`):
                A namespace (user or an organization) and a repo name separated
                by a `/`.
            discussion_num (`int`):
                The number of the Discussion or Pull Request . Must be a strictly positive integer.
            comment_id (`str`):
                The ID of the comment to edit.
            repo_type (`str`, *optional*):
                Set to `"dataset"` or `"space"` if uploading to a dataset or
                space, `None` or `"model"` if uploading to a model. Default is
                `None`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`DiscussionComment`]: the hidden comment

        <Tip>

        Raises the following errors:

            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the HuggingFace API returned an error
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if some parameter value is invalid
            - [`~utils.RepositoryNotFoundError`]
              If the repository to download from cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.

        </Tip>
        """
        warnings.warn(
            "Hidden comments' content cannot be retrieved anymore. Hiding a comment is irreversible.",
            UserWarning,
        )
        resp = self._post_discussion_changes(
            repo_id=repo_id,
            repo_type=repo_type,
            discussion_num=discussion_num,
            token=token,
            resource=f"comment/{comment_id.lower()}/hide",
        )
        return deserialize_event(resp.json()["updatedComment"])  # type: ignore

    @validate_hf_hub_args
    def add_space_secret(
        self,
        repo_id: str,
        key: str,
        value: str,
        *,
        description: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> None:
        """Adds or updates a secret in a Space.

        Secrets allow to set secret keys or tokens to a Space without hardcoding them.
        For more details, see https://huggingface.co/docs/hub/spaces-overview#managing-secrets.

        Args:
            repo_id (`str`):
                ID of the repo to update. Example: `"bigcode/in-the-stack"`.
            key (`str`):
                Secret key. Example: `"GITHUB_API_KEY"`
            value (`str`):
                Secret value. Example: `"your_github_api_key"`.
            description (`str`, *optional*):
                Secret description. Example: `"Github API key to access the Github API"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        """
        payload = {"key": key, "value": value}
        if description is not None:
            payload["description"] = description
        r = get_session().post(
            f"{self.endpoint}/api/spaces/{repo_id}/secrets",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )
        hf_raise_for_status(r)

    @validate_hf_hub_args
    def delete_space_secret(self, repo_id: str, key: str, *, token: Union[bool, str, None] = None) -> None:
        """Deletes a secret from a Space.

        Secrets allow to set secret keys or tokens to a Space without hardcoding them.
        For more details, see https://huggingface.co/docs/hub/spaces-overview#managing-secrets.

        Args:
            repo_id (`str`):
                ID of the repo to update. Example: `"bigcode/in-the-stack"`.
            key (`str`):
                Secret key. Example: `"GITHUB_API_KEY"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        """
        r = get_session().delete(
            f"{self.endpoint}/api/spaces/{repo_id}/secrets",
            headers=self._build_hf_headers(token=token),
            json={"key": key},
        )
        hf_raise_for_status(r)

    @validate_hf_hub_args
    def get_space_variables(self, repo_id: str, *, token: Union[bool, str, None] = None) -> Dict[str, SpaceVariable]:
        """Gets all variables from a Space.

        Variables allow to set environment variables to a Space without hardcoding them.
        For more details, see https://huggingface.co/docs/hub/spaces-overview#managing-secrets-and-environment-variables

        Args:
            repo_id (`str`):
                ID of the repo to query. Example: `"bigcode/in-the-stack"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        """
        r = get_session().get(
            f"{self.endpoint}/api/spaces/{repo_id}/variables",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(r)
        return {k: SpaceVariable(k, v) for k, v in r.json().items()}

    @validate_hf_hub_args
    def add_space_variable(
        self,
        repo_id: str,
        key: str,
        value: str,
        *,
        description: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> Dict[str, SpaceVariable]:
        """Adds or updates a variable in a Space.

        Variables allow to set environment variables to a Space without hardcoding them.
        For more details, see https://huggingface.co/docs/hub/spaces-overview#managing-secrets-and-environment-variables

        Args:
            repo_id (`str`):
                ID of the repo to update. Example: `"bigcode/in-the-stack"`.
            key (`str`):
                Variable key. Example: `"MODEL_REPO_ID"`
            value (`str`):
                Variable value. Example: `"the_model_repo_id"`.
            description (`str`):
                Description of the variable. Example: `"Model Repo ID of the implemented model"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        """
        payload = {"key": key, "value": value}
        if description is not None:
            payload["description"] = description
        r = get_session().post(
            f"{self.endpoint}/api/spaces/{repo_id}/variables",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )
        hf_raise_for_status(r)
        return {k: SpaceVariable(k, v) for k, v in r.json().items()}

    @validate_hf_hub_args
    def delete_space_variable(
        self, repo_id: str, key: str, *, token: Union[bool, str, None] = None
    ) -> Dict[str, SpaceVariable]:
        """Deletes a variable from a Space.

        Variables allow to set environment variables to a Space without hardcoding them.
        For more details, see https://huggingface.co/docs/hub/spaces-overview#managing-secrets-and-environment-variables

        Args:
            repo_id (`str`):
                ID of the repo to update. Example: `"bigcode/in-the-stack"`.
            key (`str`):
                Variable key. Example: `"MODEL_REPO_ID"`
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        """
        r = get_session().delete(
            f"{self.endpoint}/api/spaces/{repo_id}/variables",
            headers=self._build_hf_headers(token=token),
            json={"key": key},
        )
        hf_raise_for_status(r)
        return {k: SpaceVariable(k, v) for k, v in r.json().items()}

    @validate_hf_hub_args
    def get_space_runtime(self, repo_id: str, *, token: Union[bool, str, None] = None) -> SpaceRuntime:
        """Gets runtime information about a Space.

        Args:
            repo_id (`str`):
                ID of the repo to update. Example: `"bigcode/in-the-stack"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        Returns:
            [`SpaceRuntime`]: Runtime information about a Space including Space stage and hardware.
        """
        r = get_session().get(
            f"{self.endpoint}/api/spaces/{repo_id}/runtime", headers=self._build_hf_headers(token=token)
        )
        hf_raise_for_status(r)
        return SpaceRuntime(r.json())

    @validate_hf_hub_args
    def request_space_hardware(
        self,
        repo_id: str,
        hardware: SpaceHardware,
        *,
        token: Union[bool, str, None] = None,
        sleep_time: Optional[int] = None,
    ) -> SpaceRuntime:
        """Request new hardware for a Space.

        Args:
            repo_id (`str`):
                ID of the repo to update. Example: `"bigcode/in-the-stack"`.
            hardware (`str` or [`SpaceHardware`]):
                Hardware on which to run the Space. Example: `"t4-medium"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            sleep_time (`int`, *optional*):
                Number of seconds of inactivity to wait before a Space is put to sleep. Set to `-1` if you don't want
                your Space to sleep (default behavior for upgraded hardware). For free hardware, you can't configure
                the sleep time (value is fixed to 48 hours of inactivity).
                See https://huggingface.co/docs/hub/spaces-gpus#sleep-time for more details.
        Returns:
            [`SpaceRuntime`]: Runtime information about a Space including Space stage and hardware.

        <Tip>

        It is also possible to request hardware directly when creating the Space repo! See [`create_repo`] for details.

        </Tip>
        """
        if sleep_time is not None and hardware == SpaceHardware.CPU_BASIC:
            warnings.warn(
                "If your Space runs on the default 'cpu-basic' hardware, it will go to sleep if inactive for more"
                " than 48 hours. This value is not configurable. If you don't want your Space to deactivate or if"
                " you want to set a custom sleep time, you need to upgrade to a paid Hardware.",
                UserWarning,
            )
        payload: Dict[str, Any] = {"flavor": hardware}
        if sleep_time is not None:
            payload["sleepTimeSeconds"] = sleep_time
        r = get_session().post(
            f"{self.endpoint}/api/spaces/{repo_id}/hardware",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )
        hf_raise_for_status(r)
        return SpaceRuntime(r.json())

    @validate_hf_hub_args
    def set_space_sleep_time(
        self, repo_id: str, sleep_time: int, *, token: Union[bool, str, None] = None
    ) -> SpaceRuntime:
        """Set a custom sleep time for a Space running on upgraded hardware..

        Your Space will go to sleep after X seconds of inactivity. You are not billed when your Space is in "sleep"
        mode. If a new visitor lands on your Space, it will "wake it up". Only upgraded hardware can have a
        configurable sleep time. To know more about the sleep stage, please refer to
        https://huggingface.co/docs/hub/spaces-gpus#sleep-time.

        Args:
            repo_id (`str`):
                ID of the repo to update. Example: `"bigcode/in-the-stack"`.
            sleep_time (`int`, *optional*):
                Number of seconds of inactivity to wait before a Space is put to sleep. Set to `-1` if you don't want
                your Space to pause (default behavior for upgraded hardware). For free hardware, you can't configure
                the sleep time (value is fixed to 48 hours of inactivity).
                See https://huggingface.co/docs/hub/spaces-gpus#sleep-time for more details.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        Returns:
            [`SpaceRuntime`]: Runtime information about a Space including Space stage and hardware.

        <Tip>

        It is also possible to set a custom sleep time when requesting hardware with [`request_space_hardware`].

        </Tip>
        """
        r = get_session().post(
            f"{self.endpoint}/api/spaces/{repo_id}/sleeptime",
            headers=self._build_hf_headers(token=token),
            json={"seconds": sleep_time},
        )
        hf_raise_for_status(r)
        runtime = SpaceRuntime(r.json())

        hardware = runtime.requested_hardware or runtime.hardware
        if hardware == SpaceHardware.CPU_BASIC:
            warnings.warn(
                "If your Space runs on the default 'cpu-basic' hardware, it will go to sleep if inactive for more"
                " than 48 hours. This value is not configurable. If you don't want your Space to deactivate or if"
                " you want to set a custom sleep time, you need to upgrade to a paid Hardware.",
                UserWarning,
            )
        return runtime

    @validate_hf_hub_args
    def pause_space(self, repo_id: str, *, token: Union[bool, str, None] = None) -> SpaceRuntime:
        """Pause your Space.

        A paused Space stops executing until manually restarted by its owner. This is different from the sleeping
        state in which free Spaces go after 48h of inactivity. Paused time is not billed to your account, no matter the
        hardware you've selected. To restart your Space, use [`restart_space`] and go to your Space settings page.

        For more details, please visit [the docs](https://huggingface.co/docs/hub/spaces-gpus#pause).

        Args:
            repo_id (`str`):
                ID of the Space to pause. Example: `"Salesforce/BLIP2"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`SpaceRuntime`]: Runtime information about your Space including `stage=PAUSED` and requested hardware.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If your Space is not found (error 404). Most probably wrong repo_id or your space is private but you
                are not authenticated.
            [`~utils.HfHubHTTPError`]:
                403 Forbidden: only the owner of a Space can pause it. If you want to manage a Space that you don't
                own, either ask the owner by opening a Discussion or duplicate the Space.
            [`~utils.BadRequestError`]:
                If your Space is a static Space. Static Spaces are always running and never billed. If you want to hide
                a static Space, you can set it to private.
        """
        r = get_session().post(
            f"{self.endpoint}/api/spaces/{repo_id}/pause", headers=self._build_hf_headers(token=token)
        )
        hf_raise_for_status(r)
        return SpaceRuntime(r.json())

    @validate_hf_hub_args
    def restart_space(
        self, repo_id: str, *, token: Union[bool, str, None] = None, factory_reboot: bool = False
    ) -> SpaceRuntime:
        """Restart your Space.

        This is the only way to programmatically restart a Space if you've put it on Pause (see [`pause_space`]). You
        must be the owner of the Space to restart it. If you are using an upgraded hardware, your account will be
        billed as soon as the Space is restarted. You can trigger a restart no matter the current state of a Space.

        For more details, please visit [the docs](https://huggingface.co/docs/hub/spaces-gpus#pause).

        Args:
            repo_id (`str`):
                ID of the Space to restart. Example: `"Salesforce/BLIP2"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            factory_reboot (`bool`, *optional*):
                If `True`, the Space will be rebuilt from scratch without caching any requirements.

        Returns:
            [`SpaceRuntime`]: Runtime information about your Space.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                If your Space is not found (error 404). Most probably wrong repo_id or your space is private but you
                are not authenticated.
            [`~utils.HfHubHTTPError`]:
                403 Forbidden: only the owner of a Space can restart it. If you want to restart a Space that you don't
                own, either ask the owner by opening a Discussion or duplicate the Space.
            [`~utils.BadRequestError`]:
                If your Space is a static Space. Static Spaces are always running and never billed. If you want to hide
                a static Space, you can set it to private.
        """
        params = {}
        if factory_reboot:
            params["factory"] = "true"
        r = get_session().post(
            f"{self.endpoint}/api/spaces/{repo_id}/restart", headers=self._build_hf_headers(token=token), params=params
        )
        hf_raise_for_status(r)
        return SpaceRuntime(r.json())

    @validate_hf_hub_args
    def duplicate_space(
        self,
        from_id: str,
        to_id: Optional[str] = None,
        *,
        private: Optional[bool] = None,
        token: Union[bool, str, None] = None,
        exist_ok: bool = False,
        hardware: Optional[SpaceHardware] = None,
        storage: Optional[SpaceStorage] = None,
        sleep_time: Optional[int] = None,
        secrets: Optional[List[Dict[str, str]]] = None,
        variables: Optional[List[Dict[str, str]]] = None,
    ) -> RepoUrl:
        """Duplicate a Space.

        Programmatically duplicate a Space. The new Space will be created in your account and will be in the same state
        as the original Space (running or paused). You can duplicate a Space no matter the current state of a Space.

        Args:
            from_id (`str`):
                ID of the Space to duplicate. Example: `"pharma/CLIP-Interrogator"`.
            to_id (`str`, *optional*):
                ID of the new Space. Example: `"dog/CLIP-Interrogator"`. If not provided, the new Space will have the same
                name as the original Space, but in your account.
            private (`bool`, *optional*):
                Whether the new Space should be private or not. Defaults to the same privacy as the original Space.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
            exist_ok (`bool`, *optional*, defaults to `False`):
                If `True`, do not raise an error if repo already exists.
            hardware (`SpaceHardware` or `str`, *optional*):
                Choice of Hardware. Example: `"t4-medium"`. See [`SpaceHardware`] for a complete list.
            storage (`SpaceStorage` or `str`, *optional*):
                Choice of persistent storage tier. Example: `"small"`. See [`SpaceStorage`] for a complete list.
            sleep_time (`int`, *optional*):
                Number of seconds of inactivity to wait before a Space is put to sleep. Set to `-1` if you don't want
                your Space to sleep (default behavior for upgraded hardware). For free hardware, you can't configure
                the sleep time (value is fixed to 48 hours of inactivity).
                See https://huggingface.co/docs/hub/spaces-gpus#sleep-time for more details.
            secrets (`List[Dict[str, str]]`, *optional*):
                A list of secret keys to set in your Space. Each item is in the form `{"key": ..., "value": ..., "description": ...}` where description is optional.
                For more details, see https://huggingface.co/docs/hub/spaces-overview#managing-secrets.
            variables (`List[Dict[str, str]]`, *optional*):
                A list of public environment variables to set in your Space. Each item is in the form `{"key": ..., "value": ..., "description": ...}` where description is optional.
                For more details, see https://huggingface.co/docs/hub/spaces-overview#managing-secrets-and-environment-variables.

        Returns:
            [`RepoUrl`]: URL to the newly created repo. Value is a subclass of `str` containing
            attributes like `endpoint`, `repo_type` and `repo_id`.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
              If one of `from_id` or `to_id` cannot be found. This may be because it doesn't exist,
              or because it is set to `private` and you do not have access.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
              If the HuggingFace API returned an error

        Example:
        ```python
        >>> from huggingface_hub import duplicate_space

        # Duplicate a Space to your account
        >>> duplicate_space("multimodalart/dreambooth-training")
        RepoUrl('https://huggingface.co/spaces/nateraw/dreambooth-training',...)

        # Can set custom destination id and visibility flag.
        >>> duplicate_space("multimodalart/dreambooth-training", to_id="my-dreambooth", private=True)
        RepoUrl('https://huggingface.co/spaces/nateraw/my-dreambooth',...)
        ```
        """
        # Parse to_id if provided
        parsed_to_id = RepoUrl(to_id) if to_id is not None else None

        # Infer target repo_id
        to_namespace = (  # set namespace manually or default to username
            parsed_to_id.namespace
            if parsed_to_id is not None and parsed_to_id.namespace is not None
            else self.whoami(token)["name"]
        )
        to_repo_name = parsed_to_id.repo_name if to_id is not None else RepoUrl(from_id).repo_name  # type: ignore

        # repository must be a valid repo_id (namespace/repo_name).
        payload: Dict[str, Any] = {"repository": f"{to_namespace}/{to_repo_name}"}

        keys = ["private", "hardware", "storageTier", "sleepTimeSeconds", "secrets", "variables"]
        values = [private, hardware, storage, sleep_time, secrets, variables]
        payload.update({k: v for k, v in zip(keys, values) if v is not None})

        if sleep_time is not None and hardware == SpaceHardware.CPU_BASIC:
            warnings.warn(
                "If your Space runs on the default 'cpu-basic' hardware, it will go to sleep if inactive for more"
                " than 48 hours. This value is not configurable. If you don't want your Space to deactivate or if"
                " you want to set a custom sleep time, you need to upgrade to a paid Hardware.",
                UserWarning,
            )

        r = get_session().post(
            f"{self.endpoint}/api/spaces/{from_id}/duplicate",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )

        try:
            hf_raise_for_status(r)
        except HTTPError as err:
            if exist_ok and err.response.status_code == 409:
                # Repo already exists and `exist_ok=True`
                pass
            else:
                raise

        return RepoUrl(r.json()["url"], endpoint=self.endpoint)

    @validate_hf_hub_args
    def request_space_storage(
        self,
        repo_id: str,
        storage: SpaceStorage,
        *,
        token: Union[bool, str, None] = None,
    ) -> SpaceRuntime:
        """Request persistent storage for a Space.

        Args:
            repo_id (`str`):
                ID of the Space to update. Example: `"open-llm-leaderboard/open_llm_leaderboard"`.
            storage (`str` or [`SpaceStorage`]):
               Storage tier. Either 'small', 'medium', or 'large'.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        Returns:
            [`SpaceRuntime`]: Runtime information about a Space including Space stage and hardware.

        <Tip>

        It is not possible to decrease persistent storage after its granted. To do so, you must delete it
        via [`delete_space_storage`].

        </Tip>
        """
        payload: Dict[str, SpaceStorage] = {"tier": storage}
        r = get_session().post(
            f"{self.endpoint}/api/spaces/{repo_id}/storage",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )
        hf_raise_for_status(r)
        return SpaceRuntime(r.json())

    @validate_hf_hub_args
    def delete_space_storage(
        self,
        repo_id: str,
        *,
        token: Union[bool, str, None] = None,
    ) -> SpaceRuntime:
        """Delete persistent storage for a Space.

        Args:
            repo_id (`str`):
                ID of the Space to update. Example: `"open-llm-leaderboard/open_llm_leaderboard"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        Returns:
            [`SpaceRuntime`]: Runtime information about a Space including Space stage and hardware.
        Raises:
            [`BadRequestError`]
                If space has no persistent storage.

        """
        r = get_session().delete(
            f"{self.endpoint}/api/spaces/{repo_id}/storage",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(r)
        return SpaceRuntime(r.json())

    #######################
    # Inference Endpoints #
    #######################

    def list_inference_endpoints(
        self, namespace: Optional[str] = None, *, token: Union[bool, str, None] = None
    ) -> List[InferenceEndpoint]:
        """Lists all inference endpoints for the given namespace.

        Args:
            namespace (`str`, *optional*):
                The namespace to list endpoints for. Defaults to the current user. Set to `"*"` to list all endpoints
                from all namespaces (i.e. personal namespace and all orgs the user belongs to).
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            List[`InferenceEndpoint`]: A list of all inference endpoints for the given namespace.

        Example:
        ```python
        >>> from huggingface_hub import HfApi
        >>> api = HfApi()
        >>> api.list_inference_endpoints()
        [InferenceEndpoint(name='my-endpoint', ...), ...]
        ```
        """
        # Special case: list all endpoints for all namespaces the user has access to
        if namespace == "*":
            user = self.whoami(token=token)

            # List personal endpoints first
            endpoints: List[InferenceEndpoint] = list_inference_endpoints(namespace=self._get_namespace(token=token))

            # Then list endpoints for all orgs the user belongs to and ignore 401 errors (no billing or no access)
            for org in user.get("orgs", []):
                try:
                    endpoints += list_inference_endpoints(namespace=org["name"], token=token)
                except HfHubHTTPError as error:
                    if error.response.status_code == 401:  # Either no billing or user don't have access)
                        logger.debug("Cannot list Inference Endpoints for org '%s': %s", org["name"], error)
                    pass

            return endpoints

        # Normal case: list endpoints for a specific namespace
        namespace = namespace or self._get_namespace(token=token)

        response = get_session().get(
            f"{constants.INFERENCE_ENDPOINTS_ENDPOINT}/endpoint/{namespace}",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)

        return [
            InferenceEndpoint.from_raw(endpoint, namespace=namespace, token=token)
            for endpoint in response.json()["items"]
        ]

    def create_inference_endpoint(
        self,
        name: str,
        *,
        repository: str,
        framework: str,
        accelerator: str,
        instance_size: str,
        instance_type: str,
        region: str,
        vendor: str,
        account_id: Optional[str] = None,
        min_replica: int = 1,
        max_replica: int = 1,
        scale_to_zero_timeout: Optional[int] = None,
        revision: Optional[str] = None,
        task: Optional[str] = None,
        custom_image: Optional[Dict] = None,
        env: Optional[Dict[str, str]] = None,
        secrets: Optional[Dict[str, str]] = None,
        type: InferenceEndpointType = InferenceEndpointType.PROTECTED,
        domain: Optional[str] = None,
        path: Optional[str] = None,
        cache_http_responses: Optional[bool] = None,
        tags: Optional[List[str]] = None,
        namespace: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> InferenceEndpoint:
        """Create a new Inference Endpoint.

        Args:
            name (`str`):
                The unique name for the new Inference Endpoint.
            repository (`str`):
                The name of the model repository associated with the Inference Endpoint (e.g. `"gpt2"`).
            framework (`str`):
                The machine learning framework used for the model (e.g. `"custom"`).
            accelerator (`str`):
                The hardware accelerator to be used for inference (e.g. `"cpu"`).
            instance_size (`str`):
                The size or type of the instance to be used for hosting the model (e.g. `"x4"`).
            instance_type (`str`):
                The cloud instance type where the Inference Endpoint will be deployed (e.g. `"intel-icl"`).
            region (`str`):
                The cloud region in which the Inference Endpoint will be created (e.g. `"us-east-1"`).
            vendor (`str`):
                The cloud provider or vendor where the Inference Endpoint will be hosted (e.g. `"aws"`).
            account_id (`str`, *optional*):
                The account ID used to link a VPC to a private Inference Endpoint (if applicable).
            min_replica (`int`, *optional*):
                The minimum number of replicas (instances) to keep running for the Inference Endpoint. To enable
                scaling to zero, set this value to 0 and adjust `scale_to_zero_timeout` accordingly. Defaults to 1.
            max_replica (`int`, *optional*):
                The maximum number of replicas (instances) to scale to for the Inference Endpoint. Defaults to 1.
            scale_to_zero_timeout (`int`, *optional*):
                The duration in minutes before an inactive endpoint is scaled to zero, or no scaling to zero if
                set to None and `min_replica` is not 0. Defaults to None.
            revision (`str`, *optional*):
                The specific model revision to deploy on the Inference Endpoint (e.g. `"6c0e6080953db56375760c0471a8c5f2929baf11"`).
            task (`str`, *optional*):
                The task on which to deploy the model (e.g. `"text-classification"`).
            custom_image (`Dict`, *optional*):
                A custom Docker image to use for the Inference Endpoint. This is useful if you want to deploy an
                Inference Endpoint running on the `text-generation-inference` (TGI) framework (see examples).
            env (`Dict[str, str]`, *optional*):
                Non-secret environment variables to inject in the container environment.
            secrets (`Dict[str, str]`, *optional*):
                Secret values to inject in the container environment.
            type ([`InferenceEndpointType]`, *optional*):
                The type of the Inference Endpoint, which can be `"protected"` (default), `"public"` or `"private"`.
            domain (`str`, *optional*):
                The custom domain for the Inference Endpoint deployment, if setup the inference endpoint will be available at this domain (e.g. `"my-new-domain.cool-website.woof"`).
            path (`str`, *optional*):
                The custom path to the deployed model, should start with a `/` (e.g. `"/models/google-bert/bert-base-uncased"`).
            cache_http_responses (`bool`, *optional*):
                Whether to cache HTTP responses from the Inference Endpoint. Defaults to `False`.
            tags (`List[str]`, *optional*):
                A list of tags to associate with the Inference Endpoint.
            namespace (`str`, *optional*):
                The namespace where the Inference Endpoint will be created. Defaults to the current user's namespace.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

            Returns:
                [`InferenceEndpoint`]: information about the updated Inference Endpoint.

            Example:
            ```python
            >>> from huggingface_hub import HfApi
            >>> api = HfApi()
            >>> endpoint = api.create_inference_endpoint(
            ...     "my-endpoint-name",
            ...     repository="gpt2",
            ...     framework="pytorch",
            ...     task="text-generation",
            ...     accelerator="cpu",
            ...     vendor="aws",
            ...     region="us-east-1",
            ...     type="protected",
            ...     instance_size="x2",
            ...     instance_type="intel-icl",
            ... )
            >>> endpoint
            InferenceEndpoint(name='my-endpoint-name', status="pending",...)

            # Run inference on the endpoint
            >>> endpoint.client.text_generation(...)
            "..."
            ```

            ```python
            # Start an Inference Endpoint running Zephyr-7b-beta on TGI
            >>> from huggingface_hub import HfApi
            >>> api = HfApi()
            >>> endpoint = api.create_inference_endpoint(
            ...     "aws-zephyr-7b-beta-0486",
            ...     repository="HuggingFaceH4/zephyr-7b-beta",
            ...     framework="pytorch",
            ...     task="text-generation",
            ...     accelerator="gpu",
            ...     vendor="aws",
            ...     region="us-east-1",
            ...     type="protected",
            ...     instance_size="x1",
            ...     instance_type="nvidia-a10g",
            ...     env={
            ...           "MAX_BATCH_PREFILL_TOKENS": "2048",
            ...           "MAX_INPUT_LENGTH": "1024",
            ...           "MAX_TOTAL_TOKENS": "1512",
            ...           "MODEL_ID": "/repository"
            ...         },
            ...     custom_image={
            ...         "health_route": "/health",
            ...         "url": "ghcr.io/huggingface/text-generation-inference:1.1.0",
            ...     },
            ...    secrets={"MY_SECRET_KEY": "secret_value"},
            ...    tags=["dev", "text-generation"],
            ... )
            ```

            ```python
            # Start an Inference Endpoint running ProsusAI/finbert while scaling to zero in 15 minutes
            >>> from huggingface_hub import HfApi
            >>> api = HfApi()
            >>> endpoint = api.create_inference_endpoint(
            ...     "finbert-classifier",
            ...     repository="ProsusAI/finbert",
            ...     framework="pytorch",
            ...     task="text-classification",
            ...     min_replica=0,
            ...     scale_to_zero_timeout=15,
            ...     accelerator="cpu",
            ...     vendor="aws",
            ...     region="us-east-1",
            ...     type="protected",
            ...     instance_size="x2",
            ...     instance_type="intel-icl",
            ... )
            >>> endpoint.wait(timeout=300)
            # Run inference on the endpoint
            >>> endpoint.client.text_generation(...)
            TextClassificationOutputElement(label='positive', score=0.8983615040779114)
            ```

        """
        namespace = namespace or self._get_namespace(token=token)

        if custom_image is not None:
            image = (
                custom_image
                if next(iter(custom_image)) in constants.INFERENCE_ENDPOINT_IMAGE_KEYS
                else {"custom": custom_image}
            )
        else:
            image = {"huggingface": {}}

        payload: Dict = {
            "accountId": account_id,
            "compute": {
                "accelerator": accelerator,
                "instanceSize": instance_size,
                "instanceType": instance_type,
                "scaling": {
                    "maxReplica": max_replica,
                    "minReplica": min_replica,
                    "scaleToZeroTimeout": scale_to_zero_timeout,
                },
            },
            "model": {
                "framework": framework,
                "repository": repository,
                "revision": revision,
                "task": task,
                "image": image,
            },
            "name": name,
            "provider": {
                "region": region,
                "vendor": vendor,
            },
            "type": type,
        }
        if env:
            payload["model"]["env"] = env
        if secrets:
            payload["model"]["secrets"] = secrets
        if domain is not None or path is not None:
            payload["route"] = {}
            if domain is not None:
                payload["route"]["domain"] = domain
            if path is not None:
                payload["route"]["path"] = path
        if cache_http_responses is not None:
            payload["cacheHttpResponses"] = cache_http_responses
        if tags is not None:
            payload["tags"] = tags

        response = get_session().post(
            f"{constants.INFERENCE_ENDPOINTS_ENDPOINT}/endpoint/{namespace}",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )
        hf_raise_for_status(response)

        return InferenceEndpoint.from_raw(response.json(), namespace=namespace, token=token)

    @experimental
    @validate_hf_hub_args
    def create_inference_endpoint_from_catalog(
        self,
        repo_id: str,
        *,
        name: Optional[str] = None,
        token: Union[bool, str, None] = None,
        namespace: Optional[str] = None,
    ) -> InferenceEndpoint:
        """Create a new Inference Endpoint from a model in the Hugging Face Inference Catalog.

        The goal of the Inference Catalog is to provide a curated list of models that are optimized for inference
        and for which default configurations have been tested. See https://endpoints.huggingface.co/catalog for a list
        of available models in the catalog.

        Args:
            repo_id (`str`):
                The ID of the model in the catalog to deploy as an Inference Endpoint.
            name (`str`, *optional*):
                The unique name for the new Inference Endpoint. If not provided, a random name will be generated.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
            namespace (`str`, *optional*):
                The namespace where the Inference Endpoint will be created. Defaults to the current user's namespace.

        Returns:
            [`InferenceEndpoint`]: information about the new Inference Endpoint.

        <Tip warning={true}>

        `create_inference_endpoint_from_catalog` is experimental. Its API is subject to change in the future. Please provide feedback
        if you have any suggestions or requests.

        </Tip>
        """
        token = token or self.token or get_token()
        payload: Dict = {
            "namespace": namespace or self._get_namespace(token=token),
            "repoId": repo_id,
        }
        if name is not None:
            payload["endpointName"] = name

        response = get_session().post(
            f"{constants.INFERENCE_CATALOG_ENDPOINT}/deploy",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )
        hf_raise_for_status(response)
        data = response.json()["endpoint"]
        return InferenceEndpoint.from_raw(data, namespace=data["name"], token=token)

    @experimental
    @validate_hf_hub_args
    def list_inference_catalog(self, *, token: Union[bool, str, None] = None) -> List[str]:
        """List models available in the Hugging Face Inference Catalog.

        The goal of the Inference Catalog is to provide a curated list of models that are optimized for inference
        and for which default configurations have been tested. See https://endpoints.huggingface.co/catalog for a list
        of available models in the catalog.

        Use [`create_inference_endpoint_from_catalog`] to deploy a model from the catalog.

        Args:
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).

        Returns:
            List[`str`]: A list of model IDs available in the catalog.
        <Tip warning={true}>

        `list_inference_catalog` is experimental. Its API is subject to change in the future. Please provide feedback
        if you have any suggestions or requests.

        </Tip>
        """
        response = get_session().get(
            f"{constants.INFERENCE_CATALOG_ENDPOINT}/repo-list",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)
        return response.json()["models"]

    def get_inference_endpoint(
        self, name: str, *, namespace: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> InferenceEndpoint:
        """Get information about an Inference Endpoint.

        Args:
            name (`str`):
                The name of the Inference Endpoint to retrieve information about.
            namespace (`str`, *optional*):
                The namespace in which the Inference Endpoint is located. Defaults to the current user.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`InferenceEndpoint`]: information about the requested Inference Endpoint.

        Example:
        ```python
        >>> from huggingface_hub import HfApi
        >>> api = HfApi()
        >>> endpoint = api.get_inference_endpoint("my-text-to-image")
        >>> endpoint
        InferenceEndpoint(name='my-text-to-image', ...)

        # Get status
        >>> endpoint.status
        'running'
        >>> endpoint.url
        'https://my-text-to-image.region.vendor.endpoints.huggingface.cloud'

        # Run inference
        >>> endpoint.client.text_to_image(...)
        ```
        """
        namespace = namespace or self._get_namespace(token=token)

        response = get_session().get(
            f"{constants.INFERENCE_ENDPOINTS_ENDPOINT}/endpoint/{namespace}/{name}",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)

        return InferenceEndpoint.from_raw(response.json(), namespace=namespace, token=token)

    def update_inference_endpoint(
        self,
        name: str,
        *,
        # Compute update
        accelerator: Optional[str] = None,
        instance_size: Optional[str] = None,
        instance_type: Optional[str] = None,
        min_replica: Optional[int] = None,
        max_replica: Optional[int] = None,
        scale_to_zero_timeout: Optional[int] = None,
        # Model update
        repository: Optional[str] = None,
        framework: Optional[str] = None,
        revision: Optional[str] = None,
        task: Optional[str] = None,
        custom_image: Optional[Dict] = None,
        env: Optional[Dict[str, str]] = None,
        secrets: Optional[Dict[str, str]] = None,
        # Route update
        domain: Optional[str] = None,
        path: Optional[str] = None,
        # Other
        cache_http_responses: Optional[bool] = None,
        tags: Optional[List[str]] = None,
        namespace: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> InferenceEndpoint:
        """Update an Inference Endpoint.

        This method allows the update of either the compute configuration, the deployed model, the route, or any combination.
        All arguments are optional but at least one must be provided.

        For convenience, you can also update an Inference Endpoint using [`InferenceEndpoint.update`].

        Args:
            name (`str`):
                The name of the Inference Endpoint to update.

            accelerator (`str`, *optional*):
                The hardware accelerator to be used for inference (e.g. `"cpu"`).
            instance_size (`str`, *optional*):
                The size or type of the instance to be used for hosting the model (e.g. `"x4"`).
            instance_type (`str`, *optional*):
                The cloud instance type where the Inference Endpoint will be deployed (e.g. `"intel-icl"`).
            min_replica (`int`, *optional*):
                The minimum number of replicas (instances) to keep running for the Inference Endpoint.
            max_replica (`int`, *optional*):
                The maximum number of replicas (instances) to scale to for the Inference Endpoint.
            scale_to_zero_timeout (`int`, *optional*):
                The duration in minutes before an inactive endpoint is scaled to zero.

            repository (`str`, *optional*):
                The name of the model repository associated with the Inference Endpoint (e.g. `"gpt2"`).
            framework (`str`, *optional*):
                The machine learning framework used for the model (e.g. `"custom"`).
            revision (`str`, *optional*):
                The specific model revision to deploy on the Inference Endpoint (e.g. `"6c0e6080953db56375760c0471a8c5f2929baf11"`).
            task (`str`, *optional*):
                The task on which to deploy the model (e.g. `"text-classification"`).
            custom_image (`Dict`, *optional*):
                A custom Docker image to use for the Inference Endpoint. This is useful if you want to deploy an
                Inference Endpoint running on the `text-generation-inference` (TGI) framework (see examples).
            env (`Dict[str, str]`, *optional*):
                Non-secret environment variables to inject in the container environment
            secrets (`Dict[str, str]`, *optional*):
                Secret values to inject in the container environment.

            domain (`str`, *optional*):
                The custom domain for the Inference Endpoint deployment, if setup the inference endpoint will be available at this domain (e.g. `"my-new-domain.cool-website.woof"`).
            path (`str`, *optional*):
                The custom path to the deployed model, should start with a `/` (e.g. `"/models/google-bert/bert-base-uncased"`).

            cache_http_responses (`bool`, *optional*):
                Whether to cache HTTP responses from the Inference Endpoint.
            tags (`List[str]`, *optional*):
                A list of tags to associate with the Inference Endpoint.

            namespace (`str`, *optional*):
                The namespace where the Inference Endpoint will be updated. Defaults to the current user's namespace.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`InferenceEndpoint`]: information about the updated Inference Endpoint.
        """
        namespace = namespace or self._get_namespace(token=token)

        # Populate only the fields that are not None
        payload: Dict = defaultdict(lambda: defaultdict(dict))
        if accelerator is not None:
            payload["compute"]["accelerator"] = accelerator
        if instance_size is not None:
            payload["compute"]["instanceSize"] = instance_size
        if instance_type is not None:
            payload["compute"]["instanceType"] = instance_type
        if max_replica is not None:
            payload["compute"]["scaling"]["maxReplica"] = max_replica
        if min_replica is not None:
            payload["compute"]["scaling"]["minReplica"] = min_replica
        if scale_to_zero_timeout is not None:
            payload["compute"]["scaling"]["scaleToZeroTimeout"] = scale_to_zero_timeout
        if repository is not None:
            payload["model"]["repository"] = repository
        if framework is not None:
            payload["model"]["framework"] = framework
        if revision is not None:
            payload["model"]["revision"] = revision
        if task is not None:
            payload["model"]["task"] = task
        if custom_image is not None:
            payload["model"]["image"] = {"custom": custom_image}
        if env is not None:
            payload["model"]["env"] = env
        if secrets is not None:
            payload["model"]["secrets"] = secrets
        if domain is not None:
            payload["route"]["domain"] = domain
        if path is not None:
            payload["route"]["path"] = path
        if cache_http_responses is not None:
            payload["cacheHttpResponses"] = cache_http_responses
        if tags is not None:
            payload["tags"] = tags

        response = get_session().put(
            f"{constants.INFERENCE_ENDPOINTS_ENDPOINT}/endpoint/{namespace}/{name}",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )
        hf_raise_for_status(response)

        return InferenceEndpoint.from_raw(response.json(), namespace=namespace, token=token)

    def delete_inference_endpoint(
        self, name: str, *, namespace: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> None:
        """Delete an Inference Endpoint.

        This operation is not reversible. If you don't want to be charged for an Inference Endpoint, it is preferable
        to pause it with [`pause_inference_endpoint`] or scale it to zero with [`scale_to_zero_inference_endpoint`].

        For convenience, you can also delete an Inference Endpoint using [`InferenceEndpoint.delete`].

        Args:
            name (`str`):
                The name of the Inference Endpoint to delete.
            namespace (`str`, *optional*):
                The namespace in which the Inference Endpoint is located. Defaults to the current user.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.
        """
        namespace = namespace or self._get_namespace(token=token)
        response = get_session().delete(
            f"{constants.INFERENCE_ENDPOINTS_ENDPOINT}/endpoint/{namespace}/{name}",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)

    def pause_inference_endpoint(
        self, name: str, *, namespace: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> InferenceEndpoint:
        """Pause an Inference Endpoint.

        A paused Inference Endpoint will not be charged. It can be resumed at any time using [`resume_inference_endpoint`].
        This is different than scaling the Inference Endpoint to zero with [`scale_to_zero_inference_endpoint`], which
        would be automatically restarted when a request is made to it.

        For convenience, you can also pause an Inference Endpoint using [`pause_inference_endpoint`].

        Args:
            name (`str`):
                The name of the Inference Endpoint to pause.
            namespace (`str`, *optional*):
                The namespace in which the Inference Endpoint is located. Defaults to the current user.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`InferenceEndpoint`]: information about the paused Inference Endpoint.
        """
        namespace = namespace or self._get_namespace(token=token)

        response = get_session().post(
            f"{constants.INFERENCE_ENDPOINTS_ENDPOINT}/endpoint/{namespace}/{name}/pause",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)

        return InferenceEndpoint.from_raw(response.json(), namespace=namespace, token=token)

    def resume_inference_endpoint(
        self,
        name: str,
        *,
        namespace: Optional[str] = None,
        running_ok: bool = True,
        token: Union[bool, str, None] = None,
    ) -> InferenceEndpoint:
        """Resume an Inference Endpoint.

        For convenience, you can also resume an Inference Endpoint using [`InferenceEndpoint.resume`].

        Args:
            name (`str`):
                The name of the Inference Endpoint to resume.
            namespace (`str`, *optional*):
                The namespace in which the Inference Endpoint is located. Defaults to the current user.
            running_ok (`bool`, *optional*):
                If `True`, the method will not raise an error if the Inference Endpoint is already running. Defaults to
                `True`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`InferenceEndpoint`]: information about the resumed Inference Endpoint.
        """
        namespace = namespace or self._get_namespace(token=token)

        response = get_session().post(
            f"{constants.INFERENCE_ENDPOINTS_ENDPOINT}/endpoint/{namespace}/{name}/resume",
            headers=self._build_hf_headers(token=token),
        )
        try:
            hf_raise_for_status(response)
        except HfHubHTTPError as error:
            # If already running (and it's ok), then fetch current status and return
            if running_ok and error.response.status_code == 400 and "already running" in error.response.text:
                return self.get_inference_endpoint(name, namespace=namespace, token=token)
            # Otherwise, raise the error
            raise

        return InferenceEndpoint.from_raw(response.json(), namespace=namespace, token=token)

    def scale_to_zero_inference_endpoint(
        self, name: str, *, namespace: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> InferenceEndpoint:
        """Scale Inference Endpoint to zero.

        An Inference Endpoint scaled to zero will not be charged. It will be resume on the next request to it, with a
        cold start delay. This is different than pausing the Inference Endpoint with [`pause_inference_endpoint`], which
        would require a manual resume with [`resume_inference_endpoint`].

        For convenience, you can also scale an Inference Endpoint to zero using [`InferenceEndpoint.scale_to_zero`].

        Args:
            name (`str`):
                The name of the Inference Endpoint to scale to zero.
            namespace (`str`, *optional*):
                The namespace in which the Inference Endpoint is located. Defaults to the current user.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`InferenceEndpoint`]: information about the scaled-to-zero Inference Endpoint.
        """
        namespace = namespace or self._get_namespace(token=token)

        response = get_session().post(
            f"{constants.INFERENCE_ENDPOINTS_ENDPOINT}/endpoint/{namespace}/{name}/scale-to-zero",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)

        return InferenceEndpoint.from_raw(response.json(), namespace=namespace, token=token)

    def _get_namespace(self, token: Union[bool, str, None] = None) -> str:
        """Get the default namespace for the current user."""
        me = self.whoami(token=token)
        if me["type"] == "user":
            return me["name"]
        else:
            raise ValueError(
                "Cannot determine default namespace. You must provide a 'namespace' as input or be logged in as a"
                " user."
            )

    ########################
    # Collection Endpoints #
    ########################
    @validate_hf_hub_args
    def list_collections(
        self,
        *,
        owner: Union[List[str], str, None] = None,
        item: Union[List[str], str, None] = None,
        sort: Optional[Literal["lastModified", "trending", "upvotes"]] = None,
        limit: Optional[int] = None,
        token: Union[bool, str, None] = None,
    ) -> Iterable[Collection]:
        """List collections on the Huggingface Hub, given some filters.

        <Tip warning={true}>

        When listing collections, the item list per collection is truncated to 4 items maximum. To retrieve all items
        from a collection, you must use [`get_collection`].

        </Tip>

        Args:
            owner (`List[str]` or `str`, *optional*):
                Filter by owner's username.
            item (`List[str]` or `str`, *optional*):
                Filter collections containing a particular items. Example: `"models/teknium/OpenHermes-2.5-Mistral-7B"`, `"datasets/squad"` or `"papers/2311.12983"`.
            sort (`Literal["lastModified", "trending", "upvotes"]`, *optional*):
                Sort collections by last modified, trending or upvotes.
            limit (`int`, *optional*):
                Maximum number of collections to be returned.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterable[Collection]`: an iterable of [`Collection`] objects.
        """
        # Construct the API endpoint
        path = f"{self.endpoint}/api/collections"
        headers = self._build_hf_headers(token=token)
        params: Dict = {}
        if owner is not None:
            params.update({"owner": owner})
        if item is not None:
            params.update({"item": item})
        if sort is not None:
            params.update({"sort": sort})
        if limit is not None:
            params.update({"limit": limit})

        # Paginate over the results until limit is reached
        items = paginate(path, headers=headers, params=params)
        if limit is not None:
            items = islice(items, limit)  # Do not iterate over all pages

        # Parse as Collection and return
        for position, collection_data in enumerate(items):
            yield Collection(position=position, **collection_data)

    def get_collection(self, collection_slug: str, *, token: Union[bool, str, None] = None) -> Collection:
        """Gets information about a Collection on the Hub.

        Args:
            collection_slug (`str`):
                Slug of the collection of the Hub. Example: `"TheBloke/recent-models-64f9a55bb3115b4f513ec026"`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns: [`Collection`]

        Example:

        ```py
        >>> from huggingface_hub import get_collection
        >>> collection = get_collection("TheBloke/recent-models-64f9a55bb3115b4f513ec026")
        >>> collection.title
        'Recent models'
        >>> len(collection.items)
        37
        >>> collection.items[0]
        CollectionItem(
            item_object_id='651446103cd773a050bf64c2',
            item_id='TheBloke/U-Amethyst-20B-AWQ',
            item_type='model',
            position=88,
            note=None
        )
        ```
        """
        r = get_session().get(
            f"{self.endpoint}/api/collections/{collection_slug}", headers=self._build_hf_headers(token=token)
        )
        hf_raise_for_status(r)
        return Collection(**{**r.json(), "endpoint": self.endpoint})

    def create_collection(
        self,
        title: str,
        *,
        namespace: Optional[str] = None,
        description: Optional[str] = None,
        private: bool = False,
        exists_ok: bool = False,
        token: Union[bool, str, None] = None,
    ) -> Collection:
        """Create a new Collection on the Hub.

        Args:
            title (`str`):
                Title of the collection to create. Example: `"Recent models"`.
            namespace (`str`, *optional*):
                Namespace of the collection to create (username or org). Will default to the owner name.
            description (`str`, *optional*):
                Description of the collection to create.
            private (`bool`, *optional*):
                Whether the collection should be private or not. Defaults to `False` (i.e. public collection).
            exists_ok (`bool`, *optional*):
                If `True`, do not raise an error if collection already exists.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns: [`Collection`]

        Example:

        ```py
        >>> from huggingface_hub import create_collection
        >>> collection = create_collection(
        ...     title="ICCV 2023",
        ...     description="Portfolio of models, papers and demos I presented at ICCV 2023",
        ... )
        >>> collection.slug
        "username/iccv-2023-64f9a55bb3115b4f513ec026"
        ```
        """
        if namespace is None:
            namespace = self.whoami(token)["name"]

        payload = {
            "title": title,
            "namespace": namespace,
            "private": private,
        }
        if description is not None:
            payload["description"] = description

        r = get_session().post(
            f"{self.endpoint}/api/collections", headers=self._build_hf_headers(token=token), json=payload
        )
        try:
            hf_raise_for_status(r)
        except HTTPError as err:
            if exists_ok and err.response.status_code == 409:
                # Collection already exists and `exists_ok=True`
                slug = r.json()["slug"]
                return self.get_collection(slug, token=token)
            else:
                raise
        return Collection(**{**r.json(), "endpoint": self.endpoint})

    def update_collection_metadata(
        self,
        collection_slug: str,
        *,
        title: Optional[str] = None,
        description: Optional[str] = None,
        position: Optional[int] = None,
        private: Optional[bool] = None,
        theme: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> Collection:
        """Update metadata of a collection on the Hub.

        All arguments are optional. Only provided metadata will be updated.

        Args:
            collection_slug (`str`):
                Slug of the collection to update. Example: `"TheBloke/recent-models-64f9a55bb3115b4f513ec026"`.
            title (`str`):
                Title of the collection to update.
            description (`str`, *optional*):
                Description of the collection to update.
            position (`int`, *optional*):
                New position of the collection in the list of collections of the user.
            private (`bool`, *optional*):
                Whether the collection should be private or not.
            theme (`str`, *optional*):
                Theme of the collection on the Hub.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns: [`Collection`]

        Example:

        ```py
        >>> from huggingface_hub import update_collection_metadata
        >>> collection = update_collection_metadata(
        ...     collection_slug="username/iccv-2023-64f9a55bb3115b4f513ec026",
        ...     title="ICCV Oct. 2023"
        ...     description="Portfolio of models, datasets, papers and demos I presented at ICCV Oct. 2023",
        ...     private=False,
        ...     theme="pink",
        ... )
        >>> collection.slug
        "username/iccv-oct-2023-64f9a55bb3115b4f513ec026"
        # ^collection slug got updated but not the trailing ID
        ```
        """
        payload = {
            "position": position,
            "private": private,
            "theme": theme,
            "title": title,
            "description": description,
        }
        r = get_session().patch(
            f"{self.endpoint}/api/collections/{collection_slug}",
            headers=self._build_hf_headers(token=token),
            # Only send not-none values to the API
            json={key: value for key, value in payload.items() if value is not None},
        )
        hf_raise_for_status(r)
        return Collection(**{**r.json()["data"], "endpoint": self.endpoint})

    def delete_collection(
        self, collection_slug: str, *, missing_ok: bool = False, token: Union[bool, str, None] = None
    ) -> None:
        """Delete a collection on the Hub.

        Args:
            collection_slug (`str`):
                Slug of the collection to delete. Example: `"TheBloke/recent-models-64f9a55bb3115b4f513ec026"`.
            missing_ok (`bool`, *optional*):
                If `True`, do not raise an error if collection doesn't exists.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Example:

        ```py
        >>> from huggingface_hub import delete_collection
        >>> collection = delete_collection("username/useless-collection-64f9a55bb3115b4f513ec026", missing_ok=True)
        ```

        <Tip warning={true}>

        This is a non-revertible action. A deleted collection cannot be restored.

        </Tip>
        """
        r = get_session().delete(
            f"{self.endpoint}/api/collections/{collection_slug}", headers=self._build_hf_headers(token=token)
        )
        try:
            hf_raise_for_status(r)
        except HTTPError as err:
            if missing_ok and err.response.status_code == 404:
                # Collection doesn't exists and `missing_ok=True`
                return
            else:
                raise

    def add_collection_item(
        self,
        collection_slug: str,
        item_id: str,
        item_type: CollectionItemType_T,
        *,
        note: Optional[str] = None,
        exists_ok: bool = False,
        token: Union[bool, str, None] = None,
    ) -> Collection:
        """Add an item to a collection on the Hub.

        Args:
            collection_slug (`str`):
                Slug of the collection to update. Example: `"TheBloke/recent-models-64f9a55bb3115b4f513ec026"`.
            item_id (`str`):
                ID of the item to add to the collection. It can be the ID of a repo on the Hub (e.g. `"facebook/bart-large-mnli"`)
                or a paper id (e.g. `"2307.09288"`).
            item_type (`str`):
                Type of the item to add. Can be one of `"model"`, `"dataset"`, `"space"` or `"paper"`.
            note (`str`, *optional*):
                A note to attach to the item in the collection. The maximum size for a note is 500 characters.
            exists_ok (`bool`, *optional*):
                If `True`, do not raise an error if item already exists.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns: [`Collection`]

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 403 if you only have read-only access to the repo. This can be the case if you don't have `write`
                or `admin` role in the organization the repo belongs to or if you passed a `read` token.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the item you try to add to the collection does not exist on the Hub.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 409 if the item you try to add to the collection is already in the collection (and exists_ok=False)

        Example:

        ```py
        >>> from huggingface_hub import add_collection_item
        >>> collection = add_collection_item(
        ...     collection_slug="davanstrien/climate-64f99dc2a5067f6b65531bab",
        ...     item_id="pierre-loic/climate-news-articles",
        ...     item_type="dataset"
        ... )
        >>> collection.items[-1].item_id
        "pierre-loic/climate-news-articles"
        # ^item got added to the collection on last position

        # Add item with a note
        >>> add_collection_item(
        ...     collection_slug="davanstrien/climate-64f99dc2a5067f6b65531bab",
        ...     item_id="datasets/climate_fever",
        ...     item_type="dataset"
        ...     note="This dataset adopts the FEVER methodology that consists of 1,535 real-world claims regarding climate-change collected on the internet."
        ... )
        (...)
        ```
        """
        payload: Dict[str, Any] = {"item": {"id": item_id, "type": item_type}}
        if note is not None:
            payload["note"] = note
        r = get_session().post(
            f"{self.endpoint}/api/collections/{collection_slug}/items",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )
        try:
            hf_raise_for_status(r)
        except HTTPError as err:
            if exists_ok and err.response.status_code == 409:
                # Item already exists and `exists_ok=True`
                return self.get_collection(collection_slug, token=token)
            else:
                raise
        return Collection(**{**r.json(), "endpoint": self.endpoint})

    def update_collection_item(
        self,
        collection_slug: str,
        item_object_id: str,
        *,
        note: Optional[str] = None,
        position: Optional[int] = None,
        token: Union[bool, str, None] = None,
    ) -> None:
        """Update an item in a collection.

        Args:
            collection_slug (`str`):
                Slug of the collection to update. Example: `"TheBloke/recent-models-64f9a55bb3115b4f513ec026"`.
            item_object_id (`str`):
                ID of the item in the collection. This is not the id of the item on the Hub (repo_id or paper id).
                It must be retrieved from a [`CollectionItem`] object. Example: `collection.items[0].item_object_id`.
            note (`str`, *optional*):
                A note to attach to the item in the collection. The maximum size for a note is 500 characters.
            position (`int`, *optional*):
                New position of the item in the collection.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Example:

        ```py
        >>> from huggingface_hub import get_collection, update_collection_item

        # Get collection first
        >>> collection = get_collection("TheBloke/recent-models-64f9a55bb3115b4f513ec026")

        # Update item based on its ID (add note + update position)
        >>> update_collection_item(
        ...     collection_slug="TheBloke/recent-models-64f9a55bb3115b4f513ec026",
        ...     item_object_id=collection.items[-1].item_object_id,
        ...     note="Newly updated model!"
        ...     position=0,
        ... )
        ```
        """
        payload = {"position": position, "note": note}
        r = get_session().patch(
            f"{self.endpoint}/api/collections/{collection_slug}/items/{item_object_id}",
            headers=self._build_hf_headers(token=token),
            # Only send not-none values to the API
            json={key: value for key, value in payload.items() if value is not None},
        )
        hf_raise_for_status(r)

    def delete_collection_item(
        self,
        collection_slug: str,
        item_object_id: str,
        *,
        missing_ok: bool = False,
        token: Union[bool, str, None] = None,
    ) -> None:
        """Delete an item from a collection.

        Args:
            collection_slug (`str`):
                Slug of the collection to update. Example: `"TheBloke/recent-models-64f9a55bb3115b4f513ec026"`.
            item_object_id (`str`):
                ID of the item in the collection. This is not the id of the item on the Hub (repo_id or paper id).
                It must be retrieved from a [`CollectionItem`] object. Example: `collection.items[0].item_object_id`.
            missing_ok (`bool`, *optional*):
                If `True`, do not raise an error if item doesn't exists.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Example:

        ```py
        >>> from huggingface_hub import get_collection, delete_collection_item

        # Get collection first
        >>> collection = get_collection("TheBloke/recent-models-64f9a55bb3115b4f513ec026")

        # Delete item based on its ID
        >>> delete_collection_item(
        ...     collection_slug="TheBloke/recent-models-64f9a55bb3115b4f513ec026",
        ...     item_object_id=collection.items[-1].item_object_id,
        ... )
        ```
        """
        r = get_session().delete(
            f"{self.endpoint}/api/collections/{collection_slug}/items/{item_object_id}",
            headers=self._build_hf_headers(token=token),
        )
        try:
            hf_raise_for_status(r)
        except HTTPError as err:
            if missing_ok and err.response.status_code == 404:
                # Item already deleted and `missing_ok=True`
                return
            else:
                raise

    ##########################
    # Manage access requests #
    ##########################

    @validate_hf_hub_args
    def list_pending_access_requests(
        self, repo_id: str, *, repo_type: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> List[AccessRequest]:
        """
        Get pending access requests for a given gated repo.

        A pending request means the user has requested access to the repo but the request has not been processed yet.
        If the approval mode is automatic, this list should be empty. Pending requests can be accepted or rejected
        using [`accept_access_request`] and [`reject_access_request`].

        For more info about gated repos, see https://huggingface.co/docs/hub/models-gated.

        Args:
            repo_id (`str`):
                The id of the repo to get access requests for.
            repo_type (`str`, *optional*):
                The type of the repo to get access requests for. Must be one of `model`, `dataset` or `space`.
                Defaults to `model`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `List[AccessRequest]`: A list of [`AccessRequest`] objects. Each time contains a `username`, `email`,
            `status` and `timestamp` attribute. If the gated repo has a custom form, the `fields` attribute will
            be populated with user's answers.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 400 if the repo is not gated.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 403 if you only have read-only access to the repo. This can be the case if you don't have `write`
                or `admin` role in the organization the repo belongs to or if you passed a `read` token.

        Example:
        ```py
        >>> from huggingface_hub import list_pending_access_requests, accept_access_request

        # List pending requests
        >>> requests = list_pending_access_requests("meta-llama/Llama-2-7b")
        >>> len(requests)
        411
        >>> requests[0]
        [
            AccessRequest(
                username='clem',
                fullname='Clem 🤗',
                email='***',
                timestamp=datetime.datetime(2023, 11, 23, 18, 4, 53, 828000, tzinfo=datetime.timezone.utc),
                status='pending',
                fields=None,
            ),
            ...
        ]

        # Accept Clem's request
        >>> accept_access_request("meta-llama/Llama-2-7b", "clem")
        ```
        """
        return self._list_access_requests(repo_id, "pending", repo_type=repo_type, token=token)

    @validate_hf_hub_args
    def list_accepted_access_requests(
        self, repo_id: str, *, repo_type: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> List[AccessRequest]:
        """
        Get accepted access requests for a given gated repo.

        An accepted request means the user has requested access to the repo and the request has been accepted. The user
        can download any file of the repo. If the approval mode is automatic, this list should contains by default all
        requests. Accepted requests can be cancelled or rejected at any time using [`cancel_access_request`] and
        [`reject_access_request`]. A cancelled request will go back to the pending list while a rejected request will
        go to the rejected list. In both cases, the user will lose access to the repo.

        For more info about gated repos, see https://huggingface.co/docs/hub/models-gated.

        Args:
            repo_id (`str`):
                The id of the repo to get access requests for.
            repo_type (`str`, *optional*):
                The type of the repo to get access requests for. Must be one of `model`, `dataset` or `space`.
                Defaults to `model`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `List[AccessRequest]`: A list of [`AccessRequest`] objects. Each time contains a `username`, `email`,
            `status` and `timestamp` attribute. If the gated repo has a custom form, the `fields` attribute will
            be populated with user's answers.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 400 if the repo is not gated.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 403 if you only have read-only access to the repo. This can be the case if you don't have `write`
                or `admin` role in the organization the repo belongs to or if you passed a `read` token.

        Example:
        ```py
        >>> from huggingface_hub import list_accepted_access_requests

        >>> requests = list_accepted_access_requests("meta-llama/Llama-2-7b")
        >>> len(requests)
        411
        >>> requests[0]
        [
            AccessRequest(
                username='clem',
                fullname='Clem 🤗',
                email='***',
                timestamp=datetime.datetime(2023, 11, 23, 18, 4, 53, 828000, tzinfo=datetime.timezone.utc),
                status='accepted',
                fields=None,
            ),
            ...
        ]
        ```
        """
        return self._list_access_requests(repo_id, "accepted", repo_type=repo_type, token=token)

    @validate_hf_hub_args
    def list_rejected_access_requests(
        self, repo_id: str, *, repo_type: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> List[AccessRequest]:
        """
        Get rejected access requests for a given gated repo.

        A rejected request means the user has requested access to the repo and the request has been explicitly rejected
        by a repo owner (either you or another user from your organization). The user cannot download any file of the
        repo. Rejected requests can be accepted or cancelled at any time using [`accept_access_request`] and
        [`cancel_access_request`]. A cancelled request will go back to the pending list while an accepted request will
        go to the accepted list.

        For more info about gated repos, see https://huggingface.co/docs/hub/models-gated.

        Args:
            repo_id (`str`):
                The id of the repo to get access requests for.
            repo_type (`str`, *optional*):
                The type of the repo to get access requests for. Must be one of `model`, `dataset` or `space`.
                Defaults to `model`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `List[AccessRequest]`: A list of [`AccessRequest`] objects. Each time contains a `username`, `email`,
            `status` and `timestamp` attribute. If the gated repo has a custom form, the `fields` attribute will
            be populated with user's answers.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 400 if the repo is not gated.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 403 if you only have read-only access to the repo. This can be the case if you don't have `write`
                or `admin` role in the organization the repo belongs to or if you passed a `read` token.

        Example:
        ```py
        >>> from huggingface_hub import list_rejected_access_requests

        >>> requests = list_rejected_access_requests("meta-llama/Llama-2-7b")
        >>> len(requests)
        411
        >>> requests[0]
        [
            AccessRequest(
                username='clem',
                fullname='Clem 🤗',
                email='***',
                timestamp=datetime.datetime(2023, 11, 23, 18, 4, 53, 828000, tzinfo=datetime.timezone.utc),
                status='rejected',
                fields=None,
            ),
            ...
        ]
        ```
        """
        return self._list_access_requests(repo_id, "rejected", repo_type=repo_type, token=token)

    def _list_access_requests(
        self,
        repo_id: str,
        status: Literal["accepted", "rejected", "pending"],
        repo_type: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> List[AccessRequest]:
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL

        response = get_session().get(
            f"{constants.ENDPOINT}/api/{repo_type}s/{repo_id}/user-access-request/{status}",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)
        return [
            AccessRequest(
                username=request["user"]["user"],
                fullname=request["user"]["fullname"],
                email=request["user"].get("email"),
                status=request["status"],
                timestamp=parse_datetime(request["timestamp"]),
                fields=request.get("fields"),  # only if custom fields in form
            )
            for request in response.json()
        ]

    @validate_hf_hub_args
    def cancel_access_request(
        self, repo_id: str, user: str, *, repo_type: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> None:
        """
        Cancel an access request from a user for a given gated repo.

        A cancelled request will go back to the pending list and the user will lose access to the repo.

        For more info about gated repos, see https://huggingface.co/docs/hub/models-gated.

        Args:
            repo_id (`str`):
                The id of the repo to cancel access request for.
            user (`str`):
                The username of the user which access request should be cancelled.
            repo_type (`str`, *optional*):
                The type of the repo to cancel access request for. Must be one of `model`, `dataset` or `space`.
                Defaults to `model`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 400 if the repo is not gated.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 403 if you only have read-only access to the repo. This can be the case if you don't have `write`
                or `admin` role in the organization the repo belongs to or if you passed a `read` token.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user does not exist on the Hub.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user access request cannot be found.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user access request is already in the pending list.
        """
        self._handle_access_request(repo_id, user, "pending", repo_type=repo_type, token=token)

    @validate_hf_hub_args
    def accept_access_request(
        self, repo_id: str, user: str, *, repo_type: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> None:
        """
        Accept an access request from a user for a given gated repo.

        Once the request is accepted, the user will be able to download any file of the repo and access the community
        tab. If the approval mode is automatic, you don't have to accept requests manually. An accepted request can be
        cancelled or rejected at any time using [`cancel_access_request`] and [`reject_access_request`].

        For more info about gated repos, see https://huggingface.co/docs/hub/models-gated.

        Args:
            repo_id (`str`):
                The id of the repo to accept access request for.
            user (`str`):
                The username of the user which access request should be accepted.
            repo_type (`str`, *optional*):
                The type of the repo to accept access request for. Must be one of `model`, `dataset` or `space`.
                Defaults to `model`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 400 if the repo is not gated.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 403 if you only have read-only access to the repo. This can be the case if you don't have `write`
                or `admin` role in the organization the repo belongs to or if you passed a `read` token.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user does not exist on the Hub.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user access request cannot be found.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user access request is already in the accepted list.
        """
        self._handle_access_request(repo_id, user, "accepted", repo_type=repo_type, token=token)

    @validate_hf_hub_args
    def reject_access_request(
        self,
        repo_id: str,
        user: str,
        *,
        repo_type: Optional[str] = None,
        rejection_reason: Optional[str],
        token: Union[bool, str, None] = None,
    ) -> None:
        """
        Reject an access request from a user for a given gated repo.

        A rejected request will go to the rejected list. The user cannot download any file of the repo. Rejected
        requests can be accepted or cancelled at any time using [`accept_access_request`] and [`cancel_access_request`].
        A cancelled request will go back to the pending list while an accepted request will go to the accepted list.

        For more info about gated repos, see https://huggingface.co/docs/hub/models-gated.

        Args:
            repo_id (`str`):
                The id of the repo to reject access request for.
            user (`str`):
                The username of the user which access request should be rejected.
            repo_type (`str`, *optional*):
                The type of the repo to reject access request for. Must be one of `model`, `dataset` or `space`.
                Defaults to `model`.
            rejection_reason (`str`, *optional*):
                Optional rejection reason that will be visible to the user (max 200 characters).
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 400 if the repo is not gated.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 403 if you only have read-only access to the repo. This can be the case if you don't have `write`
                or `admin` role in the organization the repo belongs to or if you passed a `read` token.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user does not exist on the Hub.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user access request cannot be found.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user access request is already in the rejected list.
        """
        self._handle_access_request(
            repo_id, user, "rejected", repo_type=repo_type, rejection_reason=rejection_reason, token=token
        )

    @validate_hf_hub_args
    def _handle_access_request(
        self,
        repo_id: str,
        user: str,
        status: Literal["accepted", "rejected", "pending"],
        repo_type: Optional[str] = None,
        rejection_reason: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> None:
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL

        payload = {"user": user, "status": status}

        if rejection_reason is not None:
            if status != "rejected":
                raise ValueError("`rejection_reason` can only be passed when rejecting an access request.")
            payload["rejectionReason"] = rejection_reason

        response = get_session().post(
            f"{constants.ENDPOINT}/api/{repo_type}s/{repo_id}/user-access-request/handle",
            headers=self._build_hf_headers(token=token),
            json=payload,
        )
        hf_raise_for_status(response)

    @validate_hf_hub_args
    def grant_access(
        self, repo_id: str, user: str, *, repo_type: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> None:
        """
        Grant access to a user for a given gated repo.

        Granting access don't require for the user to send an access request by themselves. The user is automatically
        added to the accepted list meaning they can download the files You can revoke the granted access at any time
        using [`cancel_access_request`] or [`reject_access_request`].

        For more info about gated repos, see https://huggingface.co/docs/hub/models-gated.

        Args:
            repo_id (`str`):
                The id of the repo to grant access to.
            user (`str`):
                The username of the user to grant access.
            repo_type (`str`, *optional*):
                The type of the repo to grant access to. Must be one of `model`, `dataset` or `space`.
                Defaults to `model`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 400 if the repo is not gated.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 400 if the user already has access to the repo.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 403 if you only have read-only access to the repo. This can be the case if you don't have `write`
                or `admin` role in the organization the repo belongs to or if you passed a `read` token.
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 if the user does not exist on the Hub.
        """
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL

        response = get_session().post(
            f"{constants.ENDPOINT}/api/{repo_type}s/{repo_id}/user-access-request/grant",
            headers=self._build_hf_headers(token=token),
            json={"user": user},
        )
        hf_raise_for_status(response)
        return response.json()

    ###################
    # Manage webhooks #
    ###################

    @validate_hf_hub_args
    def get_webhook(self, webhook_id: str, *, token: Union[bool, str, None] = None) -> WebhookInfo:
        """Get a webhook by its id.

        Args:
            webhook_id (`str`):
                The unique identifier of the webhook to get.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved token, which is the recommended
                method for authentication (see https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`WebhookInfo`]:
                Info about the webhook.

        Example:
            ```python
            >>> from huggingface_hub import get_webhook
            >>> webhook = get_webhook("654bbbc16f2ec14d77f109cc")
            >>> print(webhook)
            WebhookInfo(
                id="654bbbc16f2ec14d77f109cc",
                watched=[WebhookWatchedItem(type="user", name="julien-c"), WebhookWatchedItem(type="org", name="HuggingFaceH4")],
                url="https://webhook.site/a2176e82-5720-43ee-9e06-f91cb4c91548",
                secret="my-secret",
                domains=["repo", "discussion"],
                disabled=False,
            )
            ```
        """
        response = get_session().get(
            f"{constants.ENDPOINT}/api/settings/webhooks/{webhook_id}",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)
        webhook_data = response.json()["webhook"]

        watched_items = [WebhookWatchedItem(type=item["type"], name=item["name"]) for item in webhook_data["watched"]]

        webhook = WebhookInfo(
            id=webhook_data["id"],
            url=webhook_data["url"],
            watched=watched_items,
            domains=webhook_data["domains"],
            secret=webhook_data.get("secret"),
            disabled=webhook_data["disabled"],
        )

        return webhook

    @validate_hf_hub_args
    def list_webhooks(self, *, token: Union[bool, str, None] = None) -> List[WebhookInfo]:
        """List all configured webhooks.

        Args:
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved token, which is the recommended
                method for authentication (see https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `List[WebhookInfo]`:
                List of webhook info objects.

        Example:
            ```python
            >>> from huggingface_hub import list_webhooks
            >>> webhooks = list_webhooks()
            >>> len(webhooks)
            2
            >>> webhooks[0]
            WebhookInfo(
                id="654bbbc16f2ec14d77f109cc",
                watched=[WebhookWatchedItem(type="user", name="julien-c"), WebhookWatchedItem(type="org", name="HuggingFaceH4")],
                url="https://webhook.site/a2176e82-5720-43ee-9e06-f91cb4c91548",
                secret="my-secret",
                domains=["repo", "discussion"],
                disabled=False,
            )
            ```
        """
        response = get_session().get(
            f"{constants.ENDPOINT}/api/settings/webhooks",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)
        webhooks_data = response.json()

        return [
            WebhookInfo(
                id=webhook["id"],
                url=webhook["url"],
                watched=[WebhookWatchedItem(type=item["type"], name=item["name"]) for item in webhook["watched"]],
                domains=webhook["domains"],
                secret=webhook.get("secret"),
                disabled=webhook["disabled"],
            )
            for webhook in webhooks_data
        ]

    @validate_hf_hub_args
    def create_webhook(
        self,
        *,
        url: str,
        watched: List[Union[Dict, WebhookWatchedItem]],
        domains: Optional[List[constants.WEBHOOK_DOMAIN_T]] = None,
        secret: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> WebhookInfo:
        """Create a new webhook.

        Args:
            url (`str`):
                URL to send the payload to.
            watched (`List[WebhookWatchedItem]`):
                List of [`WebhookWatchedItem`] to be watched by the webhook. It can be users, orgs, models, datasets or spaces.
                Watched items can also be provided as plain dictionaries.
            domains (`List[Literal["repo", "discussion"]]`, optional):
                List of domains to watch. It can be "repo", "discussion" or both.
            secret (`str`, optional):
                A secret to sign the payload with.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved token, which is the recommended
                method for authentication (see https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`WebhookInfo`]:
                Info about the newly created webhook.

        Example:
            ```python
            >>> from huggingface_hub import create_webhook
            >>> payload = create_webhook(
            ...     watched=[{"type": "user", "name": "julien-c"}, {"type": "org", "name": "HuggingFaceH4"}],
            ...     url="https://webhook.site/a2176e82-5720-43ee-9e06-f91cb4c91548",
            ...     domains=["repo", "discussion"],
            ...     secret="my-secret",
            ... )
            >>> print(payload)
            WebhookInfo(
                id="654bbbc16f2ec14d77f109cc",
                url="https://webhook.site/a2176e82-5720-43ee-9e06-f91cb4c91548",
                watched=[WebhookWatchedItem(type="user", name="julien-c"), WebhookWatchedItem(type="org", name="HuggingFaceH4")],
                domains=["repo", "discussion"],
                secret="my-secret",
                disabled=False,
            )
            ```
        """
        watched_dicts = [asdict(item) if isinstance(item, WebhookWatchedItem) else item for item in watched]

        response = get_session().post(
            f"{constants.ENDPOINT}/api/settings/webhooks",
            json={"watched": watched_dicts, "url": url, "domains": domains, "secret": secret},
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)
        webhook_data = response.json()["webhook"]
        watched_items = [WebhookWatchedItem(type=item["type"], name=item["name"]) for item in webhook_data["watched"]]

        webhook = WebhookInfo(
            id=webhook_data["id"],
            url=webhook_data["url"],
            watched=watched_items,
            domains=webhook_data["domains"],
            secret=webhook_data.get("secret"),
            disabled=webhook_data["disabled"],
        )

        return webhook

    @validate_hf_hub_args
    def update_webhook(
        self,
        webhook_id: str,
        *,
        url: Optional[str] = None,
        watched: Optional[List[Union[Dict, WebhookWatchedItem]]] = None,
        domains: Optional[List[constants.WEBHOOK_DOMAIN_T]] = None,
        secret: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> WebhookInfo:
        """Update an existing webhook.

        Args:
            webhook_id (`str`):
                The unique identifier of the webhook to be updated.
            url (`str`, optional):
                The URL to which the payload will be sent.
            watched (`List[WebhookWatchedItem]`, optional):
                List of items to watch. It can be users, orgs, models, datasets, or spaces.
                Refer to [`WebhookWatchedItem`] for more details. Watched items can also be provided as plain dictionaries.
            domains (`List[Literal["repo", "discussion"]]`, optional):
                The domains to watch. This can include "repo", "discussion", or both.
            secret (`str`, optional):
                A secret to sign the payload with, providing an additional layer of security.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved token, which is the recommended
                method for authentication (see https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`WebhookInfo`]:
                Info about the updated webhook.

        Example:
            ```python
            >>> from huggingface_hub import update_webhook
            >>> updated_payload = update_webhook(
            ...     webhook_id="654bbbc16f2ec14d77f109cc",
            ...     url="https://new.webhook.site/a2176e82-5720-43ee-9e06-f91cb4c91548",
            ...     watched=[{"type": "user", "name": "julien-c"}, {"type": "org", "name": "HuggingFaceH4"}],
            ...     domains=["repo"],
            ...     secret="my-secret",
            ... )
            >>> print(updated_payload)
            WebhookInfo(
                id="654bbbc16f2ec14d77f109cc",
                url="https://new.webhook.site/a2176e82-5720-43ee-9e06-f91cb4c91548",
                watched=[WebhookWatchedItem(type="user", name="julien-c"), WebhookWatchedItem(type="org", name="HuggingFaceH4")],
                domains=["repo"],
                secret="my-secret",
                disabled=False,
            ```
        """
        if watched is None:
            watched = []
        watched_dicts = [asdict(item) if isinstance(item, WebhookWatchedItem) else item for item in watched]

        response = get_session().post(
            f"{constants.ENDPOINT}/api/settings/webhooks/{webhook_id}",
            json={"watched": watched_dicts, "url": url, "domains": domains, "secret": secret},
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)
        webhook_data = response.json()["webhook"]

        watched_items = [WebhookWatchedItem(type=item["type"], name=item["name"]) for item in webhook_data["watched"]]

        webhook = WebhookInfo(
            id=webhook_data["id"],
            url=webhook_data["url"],
            watched=watched_items,
            domains=webhook_data["domains"],
            secret=webhook_data.get("secret"),
            disabled=webhook_data["disabled"],
        )

        return webhook

    @validate_hf_hub_args
    def enable_webhook(self, webhook_id: str, *, token: Union[bool, str, None] = None) -> WebhookInfo:
        """Enable a webhook (makes it "active").

        Args:
            webhook_id (`str`):
                The unique identifier of the webhook to enable.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved token, which is the recommended
                method for authentication (see https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`WebhookInfo`]:
                Info about the enabled webhook.

        Example:
            ```python
            >>> from huggingface_hub import enable_webhook
            >>> enabled_webhook = enable_webhook("654bbbc16f2ec14d77f109cc")
            >>> enabled_webhook
            WebhookInfo(
                id="654bbbc16f2ec14d77f109cc",
                url="https://webhook.site/a2176e82-5720-43ee-9e06-f91cb4c91548",
                watched=[WebhookWatchedItem(type="user", name="julien-c"), WebhookWatchedItem(type="org", name="HuggingFaceH4")],
                domains=["repo", "discussion"],
                secret="my-secret",
                disabled=False,
            )
            ```
        """
        response = get_session().post(
            f"{constants.ENDPOINT}/api/settings/webhooks/{webhook_id}/enable",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)
        webhook_data = response.json()["webhook"]

        watched_items = [WebhookWatchedItem(type=item["type"], name=item["name"]) for item in webhook_data["watched"]]

        webhook = WebhookInfo(
            id=webhook_data["id"],
            url=webhook_data["url"],
            watched=watched_items,
            domains=webhook_data["domains"],
            secret=webhook_data.get("secret"),
            disabled=webhook_data["disabled"],
        )

        return webhook

    @validate_hf_hub_args
    def disable_webhook(self, webhook_id: str, *, token: Union[bool, str, None] = None) -> WebhookInfo:
        """Disable a webhook (makes it "disabled").

        Args:
            webhook_id (`str`):
                The unique identifier of the webhook to disable.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved token, which is the recommended
                method for authentication (see https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            [`WebhookInfo`]:
                Info about the disabled webhook.

        Example:
            ```python
            >>> from huggingface_hub import disable_webhook
            >>> disabled_webhook = disable_webhook("654bbbc16f2ec14d77f109cc")
            >>> disabled_webhook
            WebhookInfo(
                id="654bbbc16f2ec14d77f109cc",
                url="https://webhook.site/a2176e82-5720-43ee-9e06-f91cb4c91548",
                watched=[WebhookWatchedItem(type="user", name="julien-c"), WebhookWatchedItem(type="org", name="HuggingFaceH4")],
                domains=["repo", "discussion"],
                secret="my-secret",
                disabled=True,
            )
            ```
        """
        response = get_session().post(
            f"{constants.ENDPOINT}/api/settings/webhooks/{webhook_id}/disable",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)
        webhook_data = response.json()["webhook"]

        watched_items = [WebhookWatchedItem(type=item["type"], name=item["name"]) for item in webhook_data["watched"]]

        webhook = WebhookInfo(
            id=webhook_data["id"],
            url=webhook_data["url"],
            watched=watched_items,
            domains=webhook_data["domains"],
            secret=webhook_data.get("secret"),
            disabled=webhook_data["disabled"],
        )

        return webhook

    @validate_hf_hub_args
    def delete_webhook(self, webhook_id: str, *, token: Union[bool, str, None] = None) -> None:
        """Delete a webhook.

        Args:
            webhook_id (`str`):
                The unique identifier of the webhook to delete.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved token, which is the recommended
                method for authentication (see https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `None`

        Example:
            ```python
            >>> from huggingface_hub import delete_webhook
            >>> delete_webhook("654bbbc16f2ec14d77f109cc")
            ```
        """
        response = get_session().delete(
            f"{constants.ENDPOINT}/api/settings/webhooks/{webhook_id}",
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(response)

    #############
    # Internals #
    #############

    def _build_hf_headers(
        self,
        token: Union[bool, str, None] = None,
        library_name: Optional[str] = None,
        library_version: Optional[str] = None,
        user_agent: Union[Dict, str, None] = None,
    ) -> Dict[str, str]:
        """
        Alias for [`build_hf_headers`] that uses the token from [`HfApi`] client
        when `token` is not provided.
        """
        if token is None:
            # Cannot do `token = token or self.token` as token can be `False`.
            token = self.token
        return build_hf_headers(
            token=token,
            library_name=library_name or self.library_name,
            library_version=library_version or self.library_version,
            user_agent=user_agent or self.user_agent,
            headers=self.headers,
        )

    def _prepare_folder_deletions(
        self,
        repo_id: str,
        repo_type: Optional[str],
        revision: Optional[str],
        path_in_repo: str,
        delete_patterns: Optional[Union[List[str], str]],
        token: Union[bool, str, None] = None,
    ) -> List[CommitOperationDelete]:
        """Generate the list of Delete operations for a commit to delete files from a repo.

        List remote files and match them against the `delete_patterns` constraints. Returns a list of [`CommitOperationDelete`]
        with the matching items.

        Note: `.gitattributes` file is essential to make a repo work properly on the Hub. This file will always be
              kept even if it matches the `delete_patterns` constraints.
        """
        if delete_patterns is None:
            # If no delete patterns, no need to list and filter remote files
            return []

        # List remote files
        filenames = self.list_repo_files(repo_id=repo_id, revision=revision, repo_type=repo_type, token=token)

        # Compute relative path in repo
        if path_in_repo and path_in_repo not in (".", "./"):
            path_in_repo = path_in_repo.strip("/") + "/"  # harmonize
            relpath_to_abspath = {
                file[len(path_in_repo) :]: file for file in filenames if file.startswith(path_in_repo)
            }
        else:
            relpath_to_abspath = {file: file for file in filenames}

        # Apply filter on relative paths and return
        return [
            CommitOperationDelete(path_in_repo=relpath_to_abspath[relpath], is_folder=False)
            for relpath in filter_repo_objects(relpath_to_abspath.keys(), allow_patterns=delete_patterns)
            if relpath_to_abspath[relpath] != ".gitattributes"
        ]

    def _prepare_upload_folder_additions(
        self,
        folder_path: Union[str, Path],
        path_in_repo: str,
        allow_patterns: Optional[Union[List[str], str]] = None,
        ignore_patterns: Optional[Union[List[str], str]] = None,
        repo_type: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> List[CommitOperationAdd]:
        """Generate the list of Add operations for a commit to upload a folder.

        Files not matching the `allow_patterns` (allowlist) and `ignore_patterns` (denylist)
        constraints are discarded.
        """

        folder_path = Path(folder_path).expanduser().resolve()
        if not folder_path.is_dir():
            raise ValueError(f"Provided path: '{folder_path}' is not a directory")

        # List files from folder
        relpath_to_abspath = {
            path.relative_to(folder_path).as_posix(): path
            for path in sorted(folder_path.glob("**/*"))  # sorted to be deterministic
            if path.is_file()
        }

        # Filter files
        # Patterns are applied on the path relative to `folder_path`. `path_in_repo` is prefixed after the filtering.
        filtered_repo_objects = list(
            filter_repo_objects(
                relpath_to_abspath.keys(), allow_patterns=allow_patterns, ignore_patterns=ignore_patterns
            )
        )

        prefix = f"{path_in_repo.strip('/')}/" if path_in_repo else ""

        # If updating a README.md file, make sure the metadata format is valid
        # It's better to fail early than to fail after all the files have been hashed.
        if "README.md" in filtered_repo_objects:
            self._validate_yaml(
                content=relpath_to_abspath["README.md"].read_text(encoding="utf8"),
                repo_type=repo_type,
                token=token,
            )
        if len(filtered_repo_objects) > 30:
            log = logger.warning if len(filtered_repo_objects) > 200 else logger.info
            log(
                "It seems you are trying to upload a large folder at once. This might take some time and then fail if "
                "the folder is too large. For such cases, it is recommended to upload in smaller batches or to use "
                "`HfApi().upload_large_folder(...)`/`huggingface-cli upload-large-folder` instead. For more details, "
                "check out https://huggingface.co/docs/huggingface_hub/main/en/guides/upload#upload-a-large-folder."
            )

        logger.info(f"Start hashing {len(filtered_repo_objects)} files.")
        operations = [
            CommitOperationAdd(
                path_or_fileobj=relpath_to_abspath[relpath],  # absolute path on disk
                path_in_repo=prefix + relpath,  # "absolute" path in repo
            )
            for relpath in filtered_repo_objects
        ]
        logger.info(f"Finished hashing {len(filtered_repo_objects)} files.")
        return operations

    def _validate_yaml(self, content: str, *, repo_type: Optional[str] = None, token: Union[bool, str, None] = None):
        """
        Validate YAML from `README.md`, used before file hashing and upload.

        Args:
            content (`str`):
                Content of `README.md` to validate.
            repo_type (`str`, *optional*):
                The type of the repo to grant access to. Must be one of `model`, `dataset` or `space`.
                Defaults to `model`.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Raises:
            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if YAML is invalid
        """
        repo_type = repo_type if repo_type is not None else constants.REPO_TYPE_MODEL
        headers = self._build_hf_headers(token=token)

        response = get_session().post(
            f"{self.endpoint}/api/validate-yaml",
            json={"content": content, "repoType": repo_type},
            headers=headers,
        )
        # Handle warnings (example: empty metadata)
        response_content = response.json()
        message = "\n".join([f"- {warning.get('message')}" for warning in response_content.get("warnings", [])])
        if message:
            warnings.warn(f"Warnings while validating metadata in README.md:\n{message}")

        # Raise on errors
        try:
            hf_raise_for_status(response)
        except BadRequestError as e:
            errors = response_content.get("errors", [])
            message = "\n".join([f"- {error.get('message')}" for error in errors])
            raise ValueError(f"Invalid metadata in README.md.\n{message}") from e

    def get_user_overview(self, username: str, token: Union[bool, str, None] = None) -> User:
        """
        Get an overview of a user on the Hub.

        Args:
            username (`str`):
                Username of the user to get an overview of.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `User`: A [`User`] object with the user's overview.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 If the user does not exist on the Hub.
        """
        r = get_session().get(
            f"{constants.ENDPOINT}/api/users/{username}/overview", headers=self._build_hf_headers(token=token)
        )
        hf_raise_for_status(r)
        return User(**r.json())

    def list_organization_members(self, organization: str, token: Union[bool, str, None] = None) -> Iterable[User]:
        """
        List of members of an organization on the Hub.

        Args:
            organization (`str`):
                Name of the organization to get the members of.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterable[User]`: A list of [`User`] objects with the members of the organization.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 If the organization does not exist on the Hub.

        """
        for member in paginate(
            path=f"{constants.ENDPOINT}/api/organizations/{organization}/members",
            params={},
            headers=self._build_hf_headers(token=token),
        ):
            yield User(**member)

    def list_user_followers(self, username: str, token: Union[bool, str, None] = None) -> Iterable[User]:
        """
        Get the list of followers of a user on the Hub.

        Args:
            username (`str`):
                Username of the user to get the followers of.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterable[User]`: A list of [`User`] objects with the followers of the user.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 If the user does not exist on the Hub.

        """
        for follower in paginate(
            path=f"{constants.ENDPOINT}/api/users/{username}/followers",
            params={},
            headers=self._build_hf_headers(token=token),
        ):
            yield User(**follower)

    def list_user_following(self, username: str, token: Union[bool, str, None] = None) -> Iterable[User]:
        """
        Get the list of users followed by a user on the Hub.

        Args:
            username (`str`):
                Username of the user to get the users followed by.
            token (Union[bool, str, None], optional):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterable[User]`: A list of [`User`] objects with the users followed by the user.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 If the user does not exist on the Hub.

        """
        for followed_user in paginate(
            path=f"{constants.ENDPOINT}/api/users/{username}/following",
            params={},
            headers=self._build_hf_headers(token=token),
        ):
            yield User(**followed_user)

    def list_papers(
        self,
        *,
        query: Optional[str] = None,
        token: Union[bool, str, None] = None,
    ) -> Iterable[PaperInfo]:
        """
        List daily papers on the Hugging Face Hub given a search query.

        Args:
            query (`str`, *optional*):
                A search query string to find papers.
                If provided, returns papers that match the query.
            token (Union[bool, str, None], *optional*):
                A valid user access token (string). Defaults to the locally saved
                token, which is the recommended method for authentication (see
                https://huggingface.co/docs/huggingface_hub/quick-start#authentication).
                To disable authentication, pass `False`.

        Returns:
            `Iterable[PaperInfo]`: an iterable of [`huggingface_hub.hf_api.PaperInfo`] objects.

        Example:

        ```python
        >>> from huggingface_hub import HfApi

        >>> api = HfApi()

        # List all papers with "attention" in their title
        >>> api.list_papers(query="attention")
        ```
        """
        path = f"{self.endpoint}/api/papers/search"
        params = {}
        if query:
            params["q"] = query
        r = get_session().get(
            path,
            params=params,
            headers=self._build_hf_headers(token=token),
        )
        hf_raise_for_status(r)
        for paper in r.json():
            yield PaperInfo(**paper)

    def paper_info(self, id: str) -> PaperInfo:
        """
        Get information for a paper on the Hub.

        Args:
            id (`str`, **optional**):
                ArXiv id of the paper.

        Returns:
            `PaperInfo`: A `PaperInfo` object.

        Raises:
            [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError):
                HTTP 404 If the paper does not exist on the Hub.
        """
        path = f"{self.endpoint}/api/papers/{id}"
        r = get_session().get(path)
        hf_raise_for_status(r)
        return PaperInfo(**r.json())

    def auth_check(
        self, repo_id: str, *, repo_type: Optional[str] = None, token: Union[bool, str, None] = None
    ) -> None:
        """
        Check if the provided user token has access to a specific repository on the Hugging Face Hub.

        This method verifies whether the user, authenticated via the provided token, has access to the specified
        repository. If the repository is not found or if the user lacks the required permissions to access it,
        the method raises an appropriate exception.

        Args:
            repo_id (`str`):
                The repository to check for access. Format should be `"user/repo_name"`.
                Example: `"user/my-cool-model"`.

            repo_type (`str`, *optional*):
                The type of the repository. Should be one of `"model"`, `"dataset"`, or `"space"`.
                If not specified, the default is `"model"`.

            token `(Union[bool, str, None]`, *optional*):
                A valid user access token. If not provided, the locally saved token will be used, which is the
                recommended authentication method. Set to `False` to disable authentication.
                Refer to: https://huggingface.co/docs/huggingface_hub/quick-start#authentication.

        Raises:
            [`~utils.RepositoryNotFoundError`]:
                Raised if the repository does not exist, is private, or the user does not have access. This can
                occur if the `repo_id` or `repo_type` is incorrect or if the repository is private but the user
                is not authenticated.

            [`~utils.GatedRepoError`]:
                Raised if the repository exists but is gated and the user is not authorized to access it.

        Example:
            Check if the user has access to a repository:

            ```python
            >>> from huggingface_hub import auth_check
            >>> from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

            try:
                auth_check("user/my-cool-model")
            except GatedRepoError:
                # Handle gated repository error
                print("You do not have permission to access this gated repository.")
            except RepositoryNotFoundError:
                # Handle repository not found error
                print("The repository was not found or you do not have access.")
            ```

            In this example:
            - If the user has access, the method completes successfully.
            - If the repository is gated or does not exist, appropriate exceptions are raised, allowing the user
            to handle them accordingly.
        """
        headers = self._build_hf_headers(token=token)
        if repo_type is None:
            repo_type = constants.REPO_TYPE_MODEL
        if repo_type not in constants.REPO_TYPES:
            raise ValueError(f"Invalid repo type, must be one of {constants.REPO_TYPES}")
        path = f"{self.endpoint}/api/{repo_type}s/{repo_id}/auth-check"
        r = get_session().get(path, headers=headers)
        hf_raise_for_status(r)


def _parse_revision_from_pr_url(pr_url: str) -> str:
    """Safely parse revision number from a PR url.

    Example:
    ```py
    >>> _parse_revision_from_pr_url("https://huggingface.co/bigscience/bloom/discussions/2")
    "refs/pr/2"
    ```
    """
    re_match = re.match(_REGEX_DISCUSSION_URL, pr_url)
    if re_match is None:
        raise RuntimeError(f"Unexpected response from the hub, expected a Pull Request URL but got: '{pr_url}'")
    return f"refs/pr/{re_match[1]}"


api = HfApi()

whoami = api.whoami
auth_check = api.auth_check
get_token_permission = api.get_token_permission

list_models = api.list_models
model_info = api.model_info

list_datasets = api.list_datasets
dataset_info = api.dataset_info

list_spaces = api.list_spaces
space_info = api.space_info

list_papers = api.list_papers
paper_info = api.paper_info

repo_exists = api.repo_exists
revision_exists = api.revision_exists
file_exists = api.file_exists
repo_info = api.repo_info
list_repo_files = api.list_repo_files
list_repo_refs = api.list_repo_refs
list_repo_commits = api.list_repo_commits
list_repo_tree = api.list_repo_tree
get_paths_info = api.get_paths_info

get_model_tags = api.get_model_tags
get_dataset_tags = api.get_dataset_tags

create_commit = api.create_commit
create_repo = api.create_repo
delete_repo = api.delete_repo
update_repo_visibility = api.update_repo_visibility
update_repo_settings = api.update_repo_settings
move_repo = api.move_repo
upload_file = api.upload_file
upload_folder = api.upload_folder
delete_file = api.delete_file
delete_folder = api.delete_folder
delete_files = api.delete_files
upload_large_folder = api.upload_large_folder
preupload_lfs_files = api.preupload_lfs_files
create_branch = api.create_branch
delete_branch = api.delete_branch
create_tag = api.create_tag
delete_tag = api.delete_tag
get_full_repo_name = api.get_full_repo_name

# Danger-zone API
super_squash_history = api.super_squash_history
list_lfs_files = api.list_lfs_files
permanently_delete_lfs_files = api.permanently_delete_lfs_files

# Safetensors helpers
get_safetensors_metadata = api.get_safetensors_metadata
parse_safetensors_file_metadata = api.parse_safetensors_file_metadata

# Background jobs
run_as_future = api.run_as_future

# Activity API
list_liked_repos = api.list_liked_repos
list_repo_likers = api.list_repo_likers
unlike = api.unlike

# Community API
get_discussion_details = api.get_discussion_details
get_repo_discussions = api.get_repo_discussions
create_discussion = api.create_discussion
create_pull_request = api.create_pull_request
change_discussion_status = api.change_discussion_status
comment_discussion = api.comment_discussion
edit_discussion_comment = api.edit_discussion_comment
rename_discussion = api.rename_discussion
merge_pull_request = api.merge_pull_request

# Space API
add_space_secret = api.add_space_secret
delete_space_secret = api.delete_space_secret
get_space_variables = api.get_space_variables
add_space_variable = api.add_space_variable
delete_space_variable = api.delete_space_variable
get_space_runtime = api.get_space_runtime
request_space_hardware = api.request_space_hardware
set_space_sleep_time = api.set_space_sleep_time
pause_space = api.pause_space
restart_space = api.restart_space
duplicate_space = api.duplicate_space
request_space_storage = api.request_space_storage
delete_space_storage = api.delete_space_storage

# Inference Endpoint API
list_inference_endpoints = api.list_inference_endpoints
create_inference_endpoint = api.create_inference_endpoint
get_inference_endpoint = api.get_inference_endpoint
update_inference_endpoint = api.update_inference_endpoint
delete_inference_endpoint = api.delete_inference_endpoint
pause_inference_endpoint = api.pause_inference_endpoint
resume_inference_endpoint = api.resume_inference_endpoint
scale_to_zero_inference_endpoint = api.scale_to_zero_inference_endpoint
create_inference_endpoint_from_catalog = api.create_inference_endpoint_from_catalog
list_inference_catalog = api.list_inference_catalog

# Collections API
get_collection = api.get_collection
list_collections = api.list_collections
create_collection = api.create_collection
update_collection_metadata = api.update_collection_metadata
delete_collection = api.delete_collection
add_collection_item = api.add_collection_item
update_collection_item = api.update_collection_item
delete_collection_item = api.delete_collection_item
delete_collection_item = api.delete_collection_item

# Access requests API
list_pending_access_requests = api.list_pending_access_requests
list_accepted_access_requests = api.list_accepted_access_requests
list_rejected_access_requests = api.list_rejected_access_requests
cancel_access_request = api.cancel_access_request
accept_access_request = api.accept_access_request
reject_access_request = api.reject_access_request
grant_access = api.grant_access

# Webhooks API
create_webhook = api.create_webhook
disable_webhook = api.disable_webhook
delete_webhook = api.delete_webhook
enable_webhook = api.enable_webhook
get_webhook = api.get_webhook
list_webhooks = api.list_webhooks
update_webhook = api.update_webhook


# User API
get_user_overview = api.get_user_overview
list_organization_members = api.list_organization_members
list_user_followers = api.list_user_followers
list_user_following = api.list_user_following
