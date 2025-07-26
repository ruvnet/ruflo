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
"""Contain helper class to retrieve/store token from/to local cache."""

from pathlib import Path
from typing import Optional

from .. import constants
from ._auth import get_token


class HfFolder:
    # TODO: deprecate when adapted in transformers/datasets/gradio
    # @_deprecate_method(version="1.0", message="Use `huggingface_hub.login` instead.")
    @classmethod
    def save_token(cls, token: str) -> None:
        """
        Save token, creating folder as needed.

        Token is saved in the huggingface home folder. You can configure it by setting
        the `HF_HOME` environment variable.

        Args:
            token (`str`):
                The token to save to the [`HfFolder`]
        """
        path_token = Path(constants.HF_TOKEN_PATH)
        path_token.parent.mkdir(parents=True, exist_ok=True)
        path_token.write_text(token)

    # TODO: deprecate when adapted in transformers/datasets/gradio
    # @_deprecate_method(version="1.0", message="Use `huggingface_hub.get_token` instead.")
    @classmethod
    def get_token(cls) -> Optional[str]:
        """
        Get token or None if not existent.

        This method is deprecated in favor of [`huggingface_hub.get_token`] but is kept for backward compatibility.
        Its behavior is the same as [`huggingface_hub.get_token`].

        Returns:
            `str` or `None`: The token, `None` if it doesn't exist.
        """
        return get_token()

    # TODO: deprecate when adapted in transformers/datasets/gradio
    # @_deprecate_method(version="1.0", message="Use `huggingface_hub.logout` instead.")
    @classmethod
    def delete_token(cls) -> None:
        """
        Deletes the token from storage. Does not fail if token does not exist.
        """
        try:
            Path(constants.HF_TOKEN_PATH).unlink()
        except FileNotFoundError:
            pass
