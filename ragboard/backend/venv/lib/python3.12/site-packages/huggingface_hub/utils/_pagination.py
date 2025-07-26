# coding=utf-8
# Copyright 2022-present, the HuggingFace Inc. team.
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
"""Contains utilities to handle pagination on Huggingface Hub."""

from typing import Dict, Iterable, Optional

import requests

from . import get_session, hf_raise_for_status, http_backoff, logging


logger = logging.get_logger(__name__)


def paginate(path: str, params: Dict, headers: Dict) -> Iterable:
    """Fetch a list of models/datasets/spaces and paginate through results.

    This is using the same "Link" header format as GitHub.
    See:
    - https://requests.readthedocs.io/en/latest/api/#requests.Response.links
    - https://docs.github.com/en/rest/guides/traversing-with-pagination#link-header
    """
    session = get_session()
    r = session.get(path, params=params, headers=headers)
    hf_raise_for_status(r)
    yield from r.json()

    # Follow pages
    # Next link already contains query params
    next_page = _get_next_page(r)
    while next_page is not None:
        logger.debug(f"Pagination detected. Requesting next page: {next_page}")
        r = http_backoff("GET", next_page, max_retries=20, retry_on_status_codes=429, headers=headers)
        hf_raise_for_status(r)
        yield from r.json()
        next_page = _get_next_page(r)


def _get_next_page(response: requests.Response) -> Optional[str]:
    return response.links.get("next", {}).get("url")
