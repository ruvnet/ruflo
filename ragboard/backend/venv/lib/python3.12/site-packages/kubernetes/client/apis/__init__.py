from __future__ import absolute_import
import warnings

# flake8: noqa

# alias kubernetes.client.api package and print deprecation warning
from kubernetes.client.api import *

warnings.filterwarnings('default', module='kubernetes.client.apis')
warnings.warn(
    "The package kubernetes.client.apis is renamed and deprecated, use kubernetes.client.api instead (please note that the trailing s was removed).",
    DeprecationWarning
)
