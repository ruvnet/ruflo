from dataclasses import dataclass
from enum import Enum
from typing import Dict, Optional

import requests

from .. import constants
from . import get_session, hf_raise_for_status, validate_hf_hub_args


class XetTokenType(str, Enum):
    READ = "read"
    WRITE = "write"


@dataclass(frozen=True)
class XetFileData:
    file_hash: str
    refresh_route: str


@dataclass(frozen=True)
class XetConnectionInfo:
    access_token: str
    expiration_unix_epoch: int
    endpoint: str


def parse_xet_file_data_from_response(response: requests.Response) -> Optional[XetFileData]:
    """
    Parse XET file metadata from an HTTP response.

    This function extracts XET file metadata from the HTTP headers or HTTP links
    of a given response object. If the required metadata is not found, it returns `None`.

    Args:
        response (`requests.Response`):
            The HTTP response object containing headers dict and links dict to extract the XET metadata from.
    Returns:
        `Optional[XetFileData]`:
            An instance of `XetFileData` containing the file hash and refresh route if the metadata
            is found. Returns `None` if the required metadata is missing.
    """
    if response is None:
        return None
    try:
        file_hash = response.headers[constants.HUGGINGFACE_HEADER_X_XET_HASH]

        if constants.HUGGINGFACE_HEADER_LINK_XET_AUTH_KEY in response.links:
            refresh_route = response.links[constants.HUGGINGFACE_HEADER_LINK_XET_AUTH_KEY]["url"]
        else:
            refresh_route = response.headers[constants.HUGGINGFACE_HEADER_X_XET_REFRESH_ROUTE]
    except KeyError:
        return None

    return XetFileData(
        file_hash=file_hash,
        refresh_route=refresh_route,
    )


def parse_xet_connection_info_from_headers(headers: Dict[str, str]) -> Optional[XetConnectionInfo]:
    """
    Parse XET connection info from the HTTP headers or return None if not found.
    Args:
        headers (`Dict`):
           HTTP headers to extract the XET metadata from.
    Returns:
        `XetConnectionInfo` or `None`:
            The information needed to connect to the XET storage service.
            Returns `None` if the headers do not contain the XET connection info.
    """
    try:
        endpoint = headers[constants.HUGGINGFACE_HEADER_X_XET_ENDPOINT]
        access_token = headers[constants.HUGGINGFACE_HEADER_X_XET_ACCESS_TOKEN]
        expiration_unix_epoch = int(headers[constants.HUGGINGFACE_HEADER_X_XET_EXPIRATION])
    except (KeyError, ValueError, TypeError):
        return None

    return XetConnectionInfo(
        endpoint=endpoint,
        access_token=access_token,
        expiration_unix_epoch=expiration_unix_epoch,
    )


@validate_hf_hub_args
def refresh_xet_connection_info(
    *,
    file_data: XetFileData,
    headers: Dict[str, str],
) -> XetConnectionInfo:
    """
    Utilizes the information in the parsed metadata to request the Hub xet connection information.
    This includes the access token, expiration, and XET service URL.
    Args:
        file_data: (`XetFileData`):
            The file data needed to refresh the xet connection information.
        headers (`Dict[str, str]`):
            Headers to use for the request, including authorization headers and user agent.
    Returns:
        `XetConnectionInfo`:
            The connection information needed to make the request to the xet storage service.
    Raises:
        [`~utils.HfHubHTTPError`]
            If the Hub API returned an error.
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If the Hub API response is improperly formatted.
    """
    if file_data.refresh_route is None:
        raise ValueError("The provided xet metadata does not contain a refresh endpoint.")
    return _fetch_xet_connection_info_with_url(file_data.refresh_route, headers)


@validate_hf_hub_args
def fetch_xet_connection_info_from_repo_info(
    *,
    token_type: XetTokenType,
    repo_id: str,
    repo_type: str,
    revision: Optional[str] = None,
    headers: Dict[str, str],
    endpoint: Optional[str] = None,
    params: Optional[Dict[str, str]] = None,
) -> XetConnectionInfo:
    """
    Uses the repo info to request a xet access token from Hub.
    Args:
        token_type (`XetTokenType`):
            Type of the token to request: `"read"` or `"write"`.
        repo_id (`str`):
            A namespace (user or an organization) and a repo name separated by a `/`.
        repo_type (`str`):
            Type of the repo to upload to: `"model"`, `"dataset"` or `"space"`.
        revision (`str`, `optional`):
            The revision of the repo to get the token for.
        headers (`Dict[str, str]`):
            Headers to use for the request, including authorization headers and user agent.
        endpoint (`str`, `optional`):
            The endpoint to use for the request. Defaults to the Hub endpoint.
        params (`Dict[str, str]`, `optional`):
            Additional parameters to pass with the request.
    Returns:
        `XetConnectionInfo`:
            The connection information needed to make the request to the xet storage service.
    Raises:
        [`~utils.HfHubHTTPError`]
            If the Hub API returned an error.
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If the Hub API response is improperly formatted.
    """
    endpoint = endpoint if endpoint is not None else constants.ENDPOINT
    url = f"{endpoint}/api/{repo_type}s/{repo_id}/xet-{token_type.value}-token/{revision}"
    return _fetch_xet_connection_info_with_url(url, headers, params)


@validate_hf_hub_args
def _fetch_xet_connection_info_with_url(
    url: str,
    headers: Dict[str, str],
    params: Optional[Dict[str, str]] = None,
) -> XetConnectionInfo:
    """
    Requests the xet connection info from the supplied URL. This includes the
    access token, expiration time, and endpoint to use for the xet storage service.
    Args:
        url: (`str`):
            The access token endpoint URL.
        headers (`Dict[str, str]`):
            Headers to use for the request, including authorization headers and user agent.
        params (`Dict[str, str]`, `optional`):
            Additional parameters to pass with the request.
    Returns:
        `XetConnectionInfo`:
            The connection information needed to make the request to the xet storage service.
    Raises:
        [`~utils.HfHubHTTPError`]
            If the Hub API returned an error.
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If the Hub API response is improperly formatted.
    """
    resp = get_session().get(headers=headers, url=url, params=params)
    hf_raise_for_status(resp)

    metadata = parse_xet_connection_info_from_headers(resp.headers)  # type: ignore
    if metadata is None:
        raise ValueError("Xet headers have not been correctly set by the server.")
    return metadata
