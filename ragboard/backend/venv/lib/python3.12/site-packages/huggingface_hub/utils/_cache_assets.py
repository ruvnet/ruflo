# coding=utf-8
# Copyright 2019-present, the HuggingFace Inc. team.
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
from pathlib import Path
from typing import Union

from ..constants import HF_ASSETS_CACHE


def cached_assets_path(
    library_name: str,
    namespace: str = "default",
    subfolder: str = "default",
    *,
    assets_dir: Union[str, Path, None] = None,
):
    """Return a folder path to cache arbitrary files.

    `huggingface_hub` provides a canonical folder path to store assets. This is the
    recommended way to integrate cache in a downstream library as it will benefit from
    the builtins tools to scan and delete the cache properly.

    The distinction is made between files cached from the Hub and assets. Files from the
    Hub are cached in a git-aware manner and entirely managed by `huggingface_hub`. See
    [related documentation](https://huggingface.co/docs/huggingface_hub/how-to-cache).
    All other files that a downstream library caches are considered to be "assets"
    (files downloaded from external sources, extracted from a .tar archive, preprocessed
    for training,...).

    Once the folder path is generated, it is guaranteed to exist and to be a directory.
    The path is based on 3 levels of depth: the library name, a namespace and a
    subfolder. Those 3 levels grants flexibility while allowing `huggingface_hub` to
    expect folders when scanning/deleting parts of the assets cache. Within a library,
    it is expected that all namespaces share the same subset of subfolder names but this
    is not a mandatory rule. The downstream library has then full control on which file
    structure to adopt within its cache. Namespace and subfolder are optional (would
    default to a `"default/"` subfolder) but library name is mandatory as we want every
    downstream library to manage its own cache.

    Expected tree:
    ```text
        assets/
        └── datasets/
        │   ├── SQuAD/
        │   │   ├── downloaded/
        │   │   ├── extracted/
        │   │   └── processed/
        │   ├── Helsinki-NLP--tatoeba_mt/
        │       ├── downloaded/
        │       ├── extracted/
        │       └── processed/
        └── transformers/
            ├── default/
            │   ├── something/
            ├── bert-base-cased/
            │   ├── default/
            │   └── training/
        hub/
        └── models--julien-c--EsperBERTo-small/
            ├── blobs/
            │   ├── (...)
            │   ├── (...)
            ├── refs/
            │   └── (...)
            └── [ 128]  snapshots/
                ├── 2439f60ef33a0d46d85da5001d52aeda5b00ce9f/
                │   ├── (...)
                └── bbc77c8132af1cc5cf678da3f1ddf2de43606d48/
                    └── (...)
    ```


    Args:
        library_name (`str`):
            Name of the library that will manage the cache folder. Example: `"dataset"`.
        namespace (`str`, *optional*, defaults to "default"):
            Namespace to which the data belongs. Example: `"SQuAD"`.
        subfolder (`str`, *optional*, defaults to "default"):
            Subfolder in which the data will be stored. Example: `extracted`.
        assets_dir (`str`, `Path`, *optional*):
            Path to the folder where assets are cached. This must not be the same folder
            where Hub files are cached. Defaults to `HF_HOME / "assets"` if not provided.
            Can also be set with `HF_ASSETS_CACHE` environment variable.

    Returns:
        Path to the cache folder (`Path`).

    Example:
    ```py
    >>> from huggingface_hub import cached_assets_path

    >>> cached_assets_path(library_name="datasets", namespace="SQuAD", subfolder="download")
    PosixPath('/home/wauplin/.cache/huggingface/extra/datasets/SQuAD/download')

    >>> cached_assets_path(library_name="datasets", namespace="SQuAD", subfolder="extracted")
    PosixPath('/home/wauplin/.cache/huggingface/extra/datasets/SQuAD/extracted')

    >>> cached_assets_path(library_name="datasets", namespace="Helsinki-NLP/tatoeba_mt")
    PosixPath('/home/wauplin/.cache/huggingface/extra/datasets/Helsinki-NLP--tatoeba_mt/default')

    >>> cached_assets_path(library_name="datasets", assets_dir="/tmp/tmp123456")
    PosixPath('/tmp/tmp123456/datasets/default/default')
    ```
    """
    # Resolve assets_dir
    if assets_dir is None:
        assets_dir = HF_ASSETS_CACHE
    assets_dir = Path(assets_dir).expanduser().resolve()

    # Avoid names that could create path issues
    for part in (" ", "/", "\\"):
        library_name = library_name.replace(part, "--")
        namespace = namespace.replace(part, "--")
        subfolder = subfolder.replace(part, "--")

    # Path to subfolder is created
    path = assets_dir / library_name / namespace / subfolder
    try:
        path.mkdir(exist_ok=True, parents=True)
    except (FileExistsError, NotADirectoryError):
        raise ValueError(f"Corrupted assets folder: cannot create directory because of an existing file ({path}).")

    # Return
    return path
