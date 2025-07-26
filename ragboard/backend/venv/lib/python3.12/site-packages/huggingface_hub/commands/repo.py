# Copyright 2025 The HuggingFace Team. All rights reserved.
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
"""Contains commands to interact with repositories on the Hugging Face Hub.

Usage:
    # create a new dataset repo on the Hub
    huggingface-cli repo create my-cool-dataset --repo-type=dataset

    # create a private model repo on the Hub
    huggingface-cli repo create my-cool-model --private
"""

import argparse
from argparse import _SubParsersAction
from typing import Optional

from huggingface_hub.commands import BaseHuggingfaceCLICommand
from huggingface_hub.commands._cli_utils import ANSI
from huggingface_hub.constants import SPACES_SDK_TYPES
from huggingface_hub.hf_api import HfApi
from huggingface_hub.utils import logging


logger = logging.get_logger(__name__)


class RepoCommands(BaseHuggingfaceCLICommand):
    @staticmethod
    def register_subcommand(parser: _SubParsersAction):
        repo_parser = parser.add_parser("repo", help="{create} Commands to interact with your huggingface.co repos.")
        repo_subparsers = repo_parser.add_subparsers(help="huggingface.co repos related commands")
        repo_create_parser = repo_subparsers.add_parser("create", help="Create a new repo on huggingface.co")
        repo_create_parser.add_argument(
            "repo_id",
            type=str,
            help="The ID of the repo to create to (e.g. `username/repo-name`). The username is optional and will be set to your username if not provided.",
        )
        repo_create_parser.add_argument(
            "--repo-type",
            type=str,
            help='Optional: set to "dataset" or "space" if creating a dataset or space, default is model.',
        )
        repo_create_parser.add_argument(
            "--space_sdk",
            type=str,
            help='Optional: Hugging Face Spaces SDK type. Required when --type is set to "space".',
            choices=SPACES_SDK_TYPES,
        )
        repo_create_parser.add_argument(
            "--private",
            action="store_true",
            help="Whether to create a private repository. Defaults to public unless the organization's default is private.",
        )
        repo_create_parser.add_argument(
            "--token",
            type=str,
            help="Hugging Face token. Will default to the locally saved token if not provided.",
        )
        repo_create_parser.add_argument(
            "--exist-ok",
            action="store_true",
            help="Do not raise an error if repo already exists.",
        )
        repo_create_parser.add_argument(
            "--resource-group-id",
            type=str,
            help="Resource group in which to create the repo. Resource groups is only available for Enterprise Hub organizations.",
        )
        repo_create_parser.add_argument(
            "--type",
            type=str,
            help="[Deprecated]: use --repo-type instead.",
        )
        repo_create_parser.add_argument(
            "-y",
            "--yes",
            action="store_true",
            help="[Deprecated] no effect.",
        )
        repo_create_parser.add_argument(
            "--organization", type=str, help="[Deprecated] Pass the organization namespace directly in the repo_id."
        )
        repo_create_parser.set_defaults(func=lambda args: RepoCreateCommand(args))


class RepoCreateCommand:
    def __init__(self, args: argparse.Namespace):
        self.repo_id: str = args.repo_id
        self.repo_type: Optional[str] = args.repo_type or args.type
        self.space_sdk: Optional[str] = args.space_sdk
        self.organization: Optional[str] = args.organization
        self.yes: bool = args.yes
        self.private: bool = args.private
        self.token: Optional[str] = args.token
        self.exist_ok: bool = args.exist_ok
        self.resource_group_id: Optional[str] = args.resource_group_id

        if args.type is not None:
            print(
                ANSI.yellow(
                    "The --type argument is deprecated and will be removed in a future version. Use --repo-type instead."
                )
            )
        if self.organization is not None:
            print(
                ANSI.yellow(
                    "The --organization argument is deprecated and will be removed in a future version. Pass the organization namespace directly in the repo_id."
                )
            )
        if self.yes:
            print(
                ANSI.yellow(
                    "The --yes argument is deprecated and will be removed in a future version. It does not have any effect."
                )
            )

        self._api = HfApi()

    def run(self):
        if self.organization is not None:
            if "/" in self.repo_id:
                print(ANSI.red("You cannot pass both --organization and a repo_id with a namespace."))
                exit(1)
            self.repo_id = f"{self.organization}/{self.repo_id}"

        repo_url = self._api.create_repo(
            repo_id=self.repo_id,
            repo_type=self.repo_type,
            private=self.private,
            token=self.token,
            exist_ok=self.exist_ok,
            resource_group_id=self.resource_group_id,
            space_sdk=self.space_sdk,
        )
        print(f"Successfully created {ANSI.bold(repo_url.repo_id)} on the Hub.")
        print(f"Your repo is now available at {ANSI.bold(repo_url)}")
