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
"""Contains command to scan the HF cache directory.

Usage:
    huggingface-cli scan-cache
    huggingface-cli scan-cache -v
    huggingface-cli scan-cache -vvv
    huggingface-cli scan-cache --dir ~/.cache/huggingface/hub
"""

import time
from argparse import Namespace, _SubParsersAction
from typing import Optional

from ..utils import CacheNotFound, HFCacheInfo, scan_cache_dir
from . import BaseHuggingfaceCLICommand
from ._cli_utils import ANSI, tabulate


class ScanCacheCommand(BaseHuggingfaceCLICommand):
    @staticmethod
    def register_subcommand(parser: _SubParsersAction):
        scan_cache_parser = parser.add_parser("scan-cache", help="Scan cache directory.")

        scan_cache_parser.add_argument(
            "--dir",
            type=str,
            default=None,
            help="cache directory to scan (optional). Default to the default HuggingFace cache.",
        )
        scan_cache_parser.add_argument(
            "-v",
            "--verbose",
            action="count",
            default=0,
            help="show a more verbose output",
        )
        scan_cache_parser.set_defaults(func=ScanCacheCommand)

    def __init__(self, args: Namespace) -> None:
        self.verbosity: int = args.verbose
        self.cache_dir: Optional[str] = args.dir

    def run(self):
        try:
            t0 = time.time()
            hf_cache_info = scan_cache_dir(self.cache_dir)
            t1 = time.time()
        except CacheNotFound as exc:
            cache_dir = exc.cache_dir
            print(f"Cache directory not found: {cache_dir}")
            return

        self._print_hf_cache_info_as_table(hf_cache_info)

        print(
            f"\nDone in {round(t1 - t0, 1)}s. Scanned {len(hf_cache_info.repos)} repo(s)"
            f" for a total of {ANSI.red(hf_cache_info.size_on_disk_str)}."
        )
        if len(hf_cache_info.warnings) > 0:
            message = f"Got {len(hf_cache_info.warnings)} warning(s) while scanning."
            if self.verbosity >= 3:
                print(ANSI.gray(message))
                for warning in hf_cache_info.warnings:
                    print(ANSI.gray(warning))
            else:
                print(ANSI.gray(message + " Use -vvv to print details."))

    def _print_hf_cache_info_as_table(self, hf_cache_info: HFCacheInfo) -> None:
        print(get_table(hf_cache_info, verbosity=self.verbosity))


def get_table(hf_cache_info: HFCacheInfo, *, verbosity: int = 0) -> str:
    """Generate a table from the [`HFCacheInfo`] object.

    Pass `verbosity=0` to get a table with a single row per repo, with columns
    "repo_id", "repo_type", "size_on_disk", "nb_files", "last_accessed", "last_modified", "refs", "local_path".

    Pass `verbosity=1` to get a table with a row per repo and revision (thus multiple rows can appear for a single repo), with columns
    "repo_id", "repo_type", "revision", "size_on_disk", "nb_files", "last_modified", "refs", "local_path".

    Example:
    ```py
    >>> from huggingface_hub.utils import scan_cache_dir
    >>> from huggingface_hub.commands.scan_cache import get_table

    >>> hf_cache_info = scan_cache_dir()
    HFCacheInfo(...)

    >>> print(get_table(hf_cache_info, verbosity=0))
    REPO ID                                             REPO TYPE SIZE ON DISK NB FILES LAST_ACCESSED LAST_MODIFIED REFS LOCAL PATH
    --------------------------------------------------- --------- ------------ -------- ------------- ------------- ---- --------------------------------------------------------------------------------------------------
    roberta-base                                        model             2.7M        5 1 day ago     1 week ago    main C:\\Users\\admin\\.cache\\huggingface\\hub\\models--roberta-base
    suno/bark                                           model             8.8K        1 1 week ago    1 week ago    main C:\\Users\\admin\\.cache\\huggingface\\hub\\models--suno--bark
    t5-base                                             model           893.8M        4 4 days ago    7 months ago  main C:\\Users\\admin\\.cache\\huggingface\\hub\\models--t5-base
    t5-large                                            model             3.0G        4 5 weeks ago   5 months ago  main C:\\Users\\admin\\.cache\\huggingface\\hub\\models--t5-large

    >>> print(get_table(hf_cache_info, verbosity=1))
    REPO ID                                             REPO TYPE REVISION                                 SIZE ON DISK NB FILES LAST_MODIFIED REFS LOCAL PATH
    --------------------------------------------------- --------- ---------------------------------------- ------------ -------- ------------- ---- -----------------------------------------------------------------------------------------------------------------------------------------------------
    roberta-base                                        model     e2da8e2f811d1448a5b465c236feacd80ffbac7b         2.7M        5 1 week ago    main C:\\Users\\admin\\.cache\\huggingface\\hub\\models--roberta-base\\snapshots\\e2da8e2f811d1448a5b465c236feacd80ffbac7b
    suno/bark                                           model     70a8a7d34168586dc5d028fa9666aceade177992         8.8K        1 1 week ago    main C:\\Users\\admin\\.cache\\huggingface\\hub\\models--suno--bark\\snapshots\\70a8a7d34168586dc5d028fa9666aceade177992
    t5-base                                             model     a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1       893.8M        4 7 months ago  main C:\\Users\\admin\\.cache\\huggingface\\hub\\models--t5-base\\snapshots\\a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1
    t5-large                                            model     150ebc2c4b72291e770f58e6057481c8d2ed331a         3.0G        4 5 months ago  main C:\\Users\\admin\\.cache\\huggingface\\hub\\models--t5-large\\snapshots\\150ebc2c4b72291e770f58e6057481c8d2ed331a                                                 ```
    ```

    Args:
        hf_cache_info ([`HFCacheInfo`]):
            The HFCacheInfo object to print.
        verbosity (`int`, *optional*):
            The verbosity level. Defaults to 0.

    Returns:
        `str`: The table as a string.
    """
    if verbosity == 0:
        return tabulate(
            rows=[
                [
                    repo.repo_id,
                    repo.repo_type,
                    "{:>12}".format(repo.size_on_disk_str),
                    repo.nb_files,
                    repo.last_accessed_str,
                    repo.last_modified_str,
                    ", ".join(sorted(repo.refs)),
                    str(repo.repo_path),
                ]
                for repo in sorted(hf_cache_info.repos, key=lambda repo: repo.repo_path)
            ],
            headers=[
                "REPO ID",
                "REPO TYPE",
                "SIZE ON DISK",
                "NB FILES",
                "LAST_ACCESSED",
                "LAST_MODIFIED",
                "REFS",
                "LOCAL PATH",
            ],
        )
    else:
        return tabulate(
            rows=[
                [
                    repo.repo_id,
                    repo.repo_type,
                    revision.commit_hash,
                    "{:>12}".format(revision.size_on_disk_str),
                    revision.nb_files,
                    revision.last_modified_str,
                    ", ".join(sorted(revision.refs)),
                    str(revision.snapshot_path),
                ]
                for repo in sorted(hf_cache_info.repos, key=lambda repo: repo.repo_path)
                for revision in sorted(repo.revisions, key=lambda revision: revision.commit_hash)
            ],
            headers=[
                "REPO ID",
                "REPO TYPE",
                "REVISION",
                "SIZE ON DISK",
                "NB FILES",
                "LAST_MODIFIED",
                "REFS",
                "LOCAL PATH",
            ],
        )
