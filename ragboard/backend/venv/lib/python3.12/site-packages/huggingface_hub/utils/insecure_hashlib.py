# Taken from https://github.com/mlflow/mlflow/pull/10119
#
# DO NOT use this function for security purposes (e.g., password hashing).
#
# In Python >= 3.9, insecure hashing algorithms such as MD5 fail in FIPS-compliant
# environments unless `usedforsecurity=False` is explicitly passed.
#
# References:
# - https://github.com/mlflow/mlflow/issues/9905
# - https://github.com/mlflow/mlflow/pull/10119
# - https://docs.python.org/3/library/hashlib.html
# - https://github.com/huggingface/transformers/pull/27038
#
# Usage:
#     ```python
#     # Use
#     from huggingface_hub.utils.insecure_hashlib import sha256
#     # instead of
#     from hashlib import sha256
#
#     # Use
#     from huggingface_hub.utils import insecure_hashlib
#     # instead of
#     import hashlib
#     ```
import functools
import hashlib
import sys


if sys.version_info >= (3, 9):
    md5 = functools.partial(hashlib.md5, usedforsecurity=False)
    sha1 = functools.partial(hashlib.sha1, usedforsecurity=False)
    sha256 = functools.partial(hashlib.sha256, usedforsecurity=False)
else:
    md5 = hashlib.md5
    sha1 = hashlib.sha1
    sha256 = hashlib.sha256
