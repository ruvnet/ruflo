# Copyright 2020 The HuggingFace Team. All rights reserved.
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

from argparse import ArgumentParser

from huggingface_hub.commands.delete_cache import DeleteCacheCommand
from huggingface_hub.commands.download import DownloadCommand
from huggingface_hub.commands.env import EnvironmentCommand
from huggingface_hub.commands.lfs import LfsCommands
from huggingface_hub.commands.repo import RepoCommands
from huggingface_hub.commands.repo_files import RepoFilesCommand
from huggingface_hub.commands.scan_cache import ScanCacheCommand
from huggingface_hub.commands.tag import TagCommands
from huggingface_hub.commands.upload import UploadCommand
from huggingface_hub.commands.upload_large_folder import UploadLargeFolderCommand
from huggingface_hub.commands.user import UserCommands
from huggingface_hub.commands.version import VersionCommand


def main():
    parser = ArgumentParser("huggingface-cli", usage="huggingface-cli <command> [<args>]")
    commands_parser = parser.add_subparsers(help="huggingface-cli command helpers")

    # Register commands
    DownloadCommand.register_subcommand(commands_parser)
    UploadCommand.register_subcommand(commands_parser)
    RepoFilesCommand.register_subcommand(commands_parser)
    EnvironmentCommand.register_subcommand(commands_parser)
    UserCommands.register_subcommand(commands_parser)
    RepoCommands.register_subcommand(commands_parser)
    LfsCommands.register_subcommand(commands_parser)
    ScanCacheCommand.register_subcommand(commands_parser)
    DeleteCacheCommand.register_subcommand(commands_parser)
    TagCommands.register_subcommand(commands_parser)
    VersionCommand.register_subcommand(commands_parser)

    # Experimental
    UploadLargeFolderCommand.register_subcommand(commands_parser)

    # Let's go
    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        exit(1)

    # Run
    service = args.func(args)
    service.run()


if __name__ == "__main__":
    main()
