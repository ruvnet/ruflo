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
"""Contains command to print information about the environment.

Usage:
    huggingface-cli env
"""

from argparse import _SubParsersAction

from ..utils import dump_environment_info
from . import BaseHuggingfaceCLICommand


class EnvironmentCommand(BaseHuggingfaceCLICommand):
    def __init__(self, args):
        self.args = args

    @staticmethod
    def register_subcommand(parser: _SubParsersAction):
        env_parser = parser.add_parser("env", help="Print information about the environment.")
        env_parser.set_defaults(func=EnvironmentCommand)

    def run(self) -> None:
        dump_environment_info()
