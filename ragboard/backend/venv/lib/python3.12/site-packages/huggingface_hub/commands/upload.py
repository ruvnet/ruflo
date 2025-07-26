# coding=utf-8
# Copyright 2023-present, the HuggingFace Inc. team.
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
"""Contains command to upload a repo or file with the CLI.

Usage:
    # Upload file (implicit)
    huggingface-cli upload my-cool-model ./my-cool-model.safetensors

    # Upload file (explicit)
    huggingface-cli upload my-cool-model ./my-cool-model.safetensors  model.safetensors

    # Upload directory (implicit). If `my-cool-model/` is a directory it will be uploaded, otherwise an exception is raised.
    huggingface-cli upload my-cool-model

    # Upload directory (explicit)
    huggingface-cli upload my-cool-model ./models/my-cool-model .

    # Upload filtered directory (example: tensorboard logs except for the last run)
    huggingface-cli upload my-cool-model ./model/training /logs --include "*.tfevents.*" --exclude "*20230905*"

    # Upload with wildcard
    huggingface-cli upload my-cool-model "./model/training/*.safetensors"

    # Upload private dataset
    huggingface-cli upload Wauplin/my-cool-dataset ./data . --repo-type=dataset --private

    # Upload with token
    huggingface-cli upload Wauplin/my-cool-model --token=hf_****

    # Sync local Space with Hub (upload new files, delete removed files)
    huggingface-cli upload Wauplin/space-example --repo-type=space --exclude="/logs/*" --delete="*" --commit-message="Sync local Space with Hub"

    # Schedule commits every 30 minutes
    huggingface-cli upload Wauplin/my-cool-model --every=30
"""

import os
import time
import warnings
from argparse import Namespace, _SubParsersAction
from typing import List, Optional

from huggingface_hub import logging
from huggingface_hub._commit_scheduler import CommitScheduler
from huggingface_hub.commands import BaseHuggingfaceCLICommand
from huggingface_hub.constants import HF_HUB_ENABLE_HF_TRANSFER
from huggingface_hub.errors import RevisionNotFoundError
from huggingface_hub.hf_api import HfApi
from huggingface_hub.utils import disable_progress_bars, enable_progress_bars
from huggingface_hub.utils._runtime import is_xet_available


logger = logging.get_logger(__name__)


class UploadCommand(BaseHuggingfaceCLICommand):
    @staticmethod
    def register_subcommand(parser: _SubParsersAction):
        upload_parser = parser.add_parser("upload", help="Upload a file or a folder to a repo on the Hub")
        upload_parser.add_argument(
            "repo_id", type=str, help="The ID of the repo to upload to (e.g. `username/repo-name`)."
        )
        upload_parser.add_argument(
            "local_path",
            nargs="?",
            help="Local path to the file or folder to upload. Wildcard patterns are supported. Defaults to current directory.",
        )
        upload_parser.add_argument(
            "path_in_repo",
            nargs="?",
            help="Path of the file or folder in the repo. Defaults to the relative path of the file or folder.",
        )
        upload_parser.add_argument(
            "--repo-type",
            choices=["model", "dataset", "space"],
            default="model",
            help="Type of the repo to upload to (e.g. `dataset`).",
        )
        upload_parser.add_argument(
            "--revision",
            type=str,
            help=(
                "An optional Git revision to push to. It can be a branch name or a PR reference. If revision does not"
                " exist and `--create-pr` is not set, a branch will be automatically created."
            ),
        )
        upload_parser.add_argument(
            "--private",
            action="store_true",
            help=(
                "Whether to create a private repo if repo doesn't exist on the Hub. Ignored if the repo already"
                " exists."
            ),
        )
        upload_parser.add_argument("--include", nargs="*", type=str, help="Glob patterns to match files to upload.")
        upload_parser.add_argument(
            "--exclude", nargs="*", type=str, help="Glob patterns to exclude from files to upload."
        )
        upload_parser.add_argument(
            "--delete",
            nargs="*",
            type=str,
            help="Glob patterns for file to be deleted from the repo while committing.",
        )
        upload_parser.add_argument(
            "--commit-message", type=str, help="The summary / title / first line of the generated commit."
        )
        upload_parser.add_argument("--commit-description", type=str, help="The description of the generated commit.")
        upload_parser.add_argument(
            "--create-pr", action="store_true", help="Whether to upload content as a new Pull Request."
        )
        upload_parser.add_argument(
            "--every",
            type=float,
            help="If set, a background job is scheduled to create commits every `every` minutes.",
        )
        upload_parser.add_argument(
            "--token", type=str, help="A User Access Token generated from https://huggingface.co/settings/tokens"
        )
        upload_parser.add_argument(
            "--quiet",
            action="store_true",
            help="If True, progress bars are disabled and only the path to the uploaded files is printed.",
        )
        upload_parser.set_defaults(func=UploadCommand)

    def __init__(self, args: Namespace) -> None:
        self.repo_id: str = args.repo_id
        self.repo_type: Optional[str] = args.repo_type
        self.revision: Optional[str] = args.revision
        self.private: bool = args.private

        self.include: Optional[List[str]] = args.include
        self.exclude: Optional[List[str]] = args.exclude
        self.delete: Optional[List[str]] = args.delete

        self.commit_message: Optional[str] = args.commit_message
        self.commit_description: Optional[str] = args.commit_description
        self.create_pr: bool = args.create_pr
        self.api: HfApi = HfApi(token=args.token, library_name="huggingface-cli")
        self.quiet: bool = args.quiet  # disable warnings and progress bars

        # Check `--every` is valid
        if args.every is not None and args.every <= 0:
            raise ValueError(f"`every` must be a positive value (got '{args.every}')")
        self.every: Optional[float] = args.every

        # Resolve `local_path` and `path_in_repo`
        repo_name: str = args.repo_id.split("/")[-1]  # e.g. "Wauplin/my-cool-model" => "my-cool-model"
        self.local_path: str
        self.path_in_repo: str

        if args.local_path is not None and any(c in args.local_path for c in ["*", "?", "["]):
            if args.include is not None:
                raise ValueError("Cannot set `--include` when passing a `local_path` containing a wildcard.")
            if args.path_in_repo is not None and args.path_in_repo != ".":
                raise ValueError("Cannot set `path_in_repo` when passing a `local_path` containing a wildcard.")
            self.local_path = "."
            self.include = args.local_path
            self.path_in_repo = "."
        elif args.local_path is None and os.path.isfile(repo_name):
            # Implicit case 1: user provided only a repo_id which happen to be a local file as well => upload it with same name
            self.local_path = repo_name
            self.path_in_repo = repo_name
        elif args.local_path is None and os.path.isdir(repo_name):
            # Implicit case 2: user provided only a repo_id which happen to be a local folder as well => upload it at root
            self.local_path = repo_name
            self.path_in_repo = "."
        elif args.local_path is None:
            # Implicit case 3: user provided only a repo_id that does not match a local file or folder
            # => the user must explicitly provide a local_path => raise exception
            raise ValueError(f"'{repo_name}' is not a local file or folder. Please set `local_path` explicitly.")
        elif args.path_in_repo is None and os.path.isfile(args.local_path):
            # Explicit local path to file, no path in repo => upload it at root with same name
            self.local_path = args.local_path
            self.path_in_repo = os.path.basename(args.local_path)
        elif args.path_in_repo is None:
            # Explicit local path to folder, no path in repo => upload at root
            self.local_path = args.local_path
            self.path_in_repo = "."
        else:
            # Finally, if both paths are explicit
            self.local_path = args.local_path
            self.path_in_repo = args.path_in_repo

    def run(self) -> None:
        if self.quiet:
            disable_progress_bars()
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                print(self._upload())
            enable_progress_bars()
        else:
            logging.set_verbosity_info()
            print(self._upload())
            logging.set_verbosity_warning()

    def _upload(self) -> str:
        if os.path.isfile(self.local_path):
            if self.include is not None and len(self.include) > 0:
                warnings.warn("Ignoring `--include` since a single file is uploaded.")
            if self.exclude is not None and len(self.exclude) > 0:
                warnings.warn("Ignoring `--exclude` since a single file is uploaded.")
            if self.delete is not None and len(self.delete) > 0:
                warnings.warn("Ignoring `--delete` since a single file is uploaded.")

        if not is_xet_available() and not HF_HUB_ENABLE_HF_TRANSFER:
            logger.info(
                "Consider using `hf_transfer` for faster uploads. This solution comes with some limitations. See"
                " https://huggingface.co/docs/huggingface_hub/hf_transfer for more details."
            )

        # Schedule commits if `every` is set
        if self.every is not None:
            if os.path.isfile(self.local_path):
                # If file => watch entire folder + use allow_patterns
                folder_path = os.path.dirname(self.local_path)
                path_in_repo = (
                    self.path_in_repo[: -len(self.local_path)]  # remove filename from path_in_repo
                    if self.path_in_repo.endswith(self.local_path)
                    else self.path_in_repo
                )
                allow_patterns = [self.local_path]
                ignore_patterns = []
            else:
                folder_path = self.local_path
                path_in_repo = self.path_in_repo
                allow_patterns = self.include or []
                ignore_patterns = self.exclude or []
                if self.delete is not None and len(self.delete) > 0:
                    warnings.warn("Ignoring `--delete` when uploading with scheduled commits.")

            scheduler = CommitScheduler(
                folder_path=folder_path,
                repo_id=self.repo_id,
                repo_type=self.repo_type,
                revision=self.revision,
                allow_patterns=allow_patterns,
                ignore_patterns=ignore_patterns,
                path_in_repo=path_in_repo,
                private=self.private,
                every=self.every,
                hf_api=self.api,
            )
            print(f"Scheduling commits every {self.every} minutes to {scheduler.repo_id}.")
            try:  # Block main thread until KeyboardInterrupt
                while True:
                    time.sleep(100)
            except KeyboardInterrupt:
                scheduler.stop()
                return "Stopped scheduled commits."

        # Otherwise, create repo and proceed with the upload
        if not os.path.isfile(self.local_path) and not os.path.isdir(self.local_path):
            raise FileNotFoundError(f"No such file or directory: '{self.local_path}'.")
        repo_id = self.api.create_repo(
            repo_id=self.repo_id,
            repo_type=self.repo_type,
            exist_ok=True,
            private=self.private,
            space_sdk="gradio" if self.repo_type == "space" else None,
            # ^ We don't want it to fail when uploading to a Space => let's set Gradio by default.
            # ^ I'd rather not add CLI args to set it explicitly as we already have `huggingface-cli repo create` for that.
        ).repo_id

        # Check if branch already exists and if not, create it
        if self.revision is not None and not self.create_pr:
            try:
                self.api.repo_info(repo_id=repo_id, repo_type=self.repo_type, revision=self.revision)
            except RevisionNotFoundError:
                logger.info(f"Branch '{self.revision}' not found. Creating it...")
                self.api.create_branch(repo_id=repo_id, repo_type=self.repo_type, branch=self.revision, exist_ok=True)
                # ^ `exist_ok=True` to avoid race concurrency issues

        # File-based upload
        if os.path.isfile(self.local_path):
            return self.api.upload_file(
                path_or_fileobj=self.local_path,
                path_in_repo=self.path_in_repo,
                repo_id=repo_id,
                repo_type=self.repo_type,
                revision=self.revision,
                commit_message=self.commit_message,
                commit_description=self.commit_description,
                create_pr=self.create_pr,
            )

        # Folder-based upload
        else:
            return self.api.upload_folder(
                folder_path=self.local_path,
                path_in_repo=self.path_in_repo,
                repo_id=repo_id,
                repo_type=self.repo_type,
                revision=self.revision,
                commit_message=self.commit_message,
                commit_description=self.commit_description,
                create_pr=self.create_pr,
                allow_patterns=self.include,
                ignore_patterns=self.exclude,
                delete_patterns=self.delete,
            )
