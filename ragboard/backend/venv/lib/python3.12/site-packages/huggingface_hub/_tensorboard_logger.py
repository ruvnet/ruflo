# Copyright 2023 The HuggingFace Team. All rights reserved.
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
"""Contains a logger to push training logs to the Hub, using Tensorboard."""

from pathlib import Path
from typing import TYPE_CHECKING, List, Optional, Union

from ._commit_scheduler import CommitScheduler
from .errors import EntryNotFoundError
from .repocard import ModelCard
from .utils import experimental


# Depending on user's setup, SummaryWriter can come either from 'tensorboardX'
# or from 'torch.utils.tensorboard'. Both are compatible so let's try to load
# from either of them.
try:
    from tensorboardX import SummaryWriter

    is_summary_writer_available = True

except ImportError:
    try:
        from torch.utils.tensorboard import SummaryWriter

        is_summary_writer_available = False
    except ImportError:
        # Dummy class to avoid failing at import. Will raise on instance creation.
        SummaryWriter = object
        is_summary_writer_available = False

if TYPE_CHECKING:
    from tensorboardX import SummaryWriter


class HFSummaryWriter(SummaryWriter):
    """
    Wrapper around the tensorboard's `SummaryWriter` to push training logs to the Hub.

    Data is logged locally and then pushed to the Hub asynchronously. Pushing data to the Hub is done in a separate
    thread to avoid blocking the training script. In particular, if the upload fails for any reason (e.g. a connection
    issue), the main script will not be interrupted. Data is automatically pushed to the Hub every `commit_every`
    minutes (default to every 5 minutes).

    <Tip warning={true}>

    `HFSummaryWriter` is experimental. Its API is subject to change in the future without prior notice.

    </Tip>

    Args:
        repo_id (`str`):
            The id of the repo to which the logs will be pushed.
        logdir (`str`, *optional*):
            The directory where the logs will be written. If not specified, a local directory will be created by the
            underlying `SummaryWriter` object.
        commit_every (`int` or `float`, *optional*):
            The frequency (in minutes) at which the logs will be pushed to the Hub. Defaults to 5 minutes.
        squash_history (`bool`, *optional*):
            Whether to squash the history of the repo after each commit. Defaults to `False`. Squashing commits is
            useful to avoid degraded performances on the repo when it grows too large.
        repo_type (`str`, *optional*):
            The type of the repo to which the logs will be pushed. Defaults to "model".
        repo_revision (`str`, *optional*):
            The revision of the repo to which the logs will be pushed. Defaults to "main".
        repo_private (`bool`, *optional*):
            Whether to make the repo private. If `None` (default), the repo will be public unless the organization's default is private. This value is ignored if the repo already exists.
        path_in_repo (`str`, *optional*):
            The path to the folder in the repo where the logs will be pushed. Defaults to "tensorboard/".
        repo_allow_patterns (`List[str]` or `str`, *optional*):
            A list of patterns to include in the upload. Defaults to `"*.tfevents.*"`. Check out the
            [upload guide](https://huggingface.co/docs/huggingface_hub/guides/upload#upload-a-folder) for more details.
        repo_ignore_patterns (`List[str]` or `str`, *optional*):
            A list of patterns to exclude in the upload. Check out the
            [upload guide](https://huggingface.co/docs/huggingface_hub/guides/upload#upload-a-folder) for more details.
        token (`str`, *optional*):
            Authentication token. Will default to the stored token. See https://huggingface.co/settings/token for more
            details
        kwargs:
            Additional keyword arguments passed to `SummaryWriter`.

    Examples:
    ```diff
    # Taken from https://pytorch.org/docs/stable/tensorboard.html
    - from torch.utils.tensorboard import SummaryWriter
    + from huggingface_hub import HFSummaryWriter

    import numpy as np

    - writer = SummaryWriter()
    + writer = HFSummaryWriter(repo_id="username/my-trained-model")

    for n_iter in range(100):
        writer.add_scalar('Loss/train', np.random.random(), n_iter)
        writer.add_scalar('Loss/test', np.random.random(), n_iter)
        writer.add_scalar('Accuracy/train', np.random.random(), n_iter)
        writer.add_scalar('Accuracy/test', np.random.random(), n_iter)
    ```

    ```py
    >>> from huggingface_hub import HFSummaryWriter

    # Logs are automatically pushed every 15 minutes (5 by default) + when exiting the context manager
    >>> with HFSummaryWriter(repo_id="test_hf_logger", commit_every=15) as logger:
    ...     logger.add_scalar("a", 1)
    ...     logger.add_scalar("b", 2)
    ```
    """

    @experimental
    def __new__(cls, *args, **kwargs) -> "HFSummaryWriter":
        if not is_summary_writer_available:
            raise ImportError(
                "You must have `tensorboard` installed to use `HFSummaryWriter`. Please run `pip install --upgrade"
                " tensorboardX` first."
            )
        return super().__new__(cls)

    def __init__(
        self,
        repo_id: str,
        *,
        logdir: Optional[str] = None,
        commit_every: Union[int, float] = 5,
        squash_history: bool = False,
        repo_type: Optional[str] = None,
        repo_revision: Optional[str] = None,
        repo_private: Optional[bool] = None,
        path_in_repo: Optional[str] = "tensorboard",
        repo_allow_patterns: Optional[Union[List[str], str]] = "*.tfevents.*",
        repo_ignore_patterns: Optional[Union[List[str], str]] = None,
        token: Optional[str] = None,
        **kwargs,
    ):
        # Initialize SummaryWriter
        super().__init__(logdir=logdir, **kwargs)

        # Check logdir has been correctly initialized and fail early otherwise. In practice, SummaryWriter takes care of it.
        if not isinstance(self.logdir, str):
            raise ValueError(f"`self.logdir` must be a string. Got '{self.logdir}' of type {type(self.logdir)}.")

        # Append logdir name to `path_in_repo`
        if path_in_repo is None or path_in_repo == "":
            path_in_repo = Path(self.logdir).name
        else:
            path_in_repo = path_in_repo.strip("/") + "/" + Path(self.logdir).name

        # Initialize scheduler
        self.scheduler = CommitScheduler(
            folder_path=self.logdir,
            path_in_repo=path_in_repo,
            repo_id=repo_id,
            repo_type=repo_type,
            revision=repo_revision,
            private=repo_private,
            token=token,
            allow_patterns=repo_allow_patterns,
            ignore_patterns=repo_ignore_patterns,
            every=commit_every,
            squash_history=squash_history,
        )

        # Exposing some high-level info at root level
        self.repo_id = self.scheduler.repo_id
        self.repo_type = self.scheduler.repo_type
        self.repo_revision = self.scheduler.revision

        # Add `hf-summary-writer` tag to the model card metadata
        try:
            card = ModelCard.load(repo_id_or_path=self.repo_id, repo_type=self.repo_type)
        except EntryNotFoundError:
            card = ModelCard("")
        tags = card.data.get("tags", [])
        if "hf-summary-writer" not in tags:
            tags.append("hf-summary-writer")
            card.data["tags"] = tags
            card.push_to_hub(repo_id=self.repo_id, repo_type=self.repo_type)

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Push to hub in a non-blocking way when exiting the logger's context manager."""
        super().__exit__(exc_type, exc_val, exc_tb)
        future = self.scheduler.trigger()
        future.result()
