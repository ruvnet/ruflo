# Copyright 2022 The HuggingFace Team. All rights reserved.
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
"""Contains command to print information about the version.

Usage:
    huggingface-cli version
"""

from argparse import _SubParsersAction

from huggingface_hub import __version__

from . import BaseHuggingfaceCLICommand


class VersionCommand(BaseHuggingfaceCLICommand):
    def __init__(self, args):
        self.args = args

    @staticmethod
    def register_subcommand(parser: _SubParsersAction):
        version_parser = parser.add_parser("version", help="Print information about the huggingface-cli version.")
        version_parser.set_defaults(func=VersionCommand)

    def run(self) -> None:
        print(f"huggingface_hub version: {__version__}")
