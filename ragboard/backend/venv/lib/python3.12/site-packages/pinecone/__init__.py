"""
.. include:: ../README.md
"""
import warnings
from tqdm import TqdmExperimentalWarning

warnings.filterwarnings("ignore", category=TqdmExperimentalWarning)

from .config import *
from .exceptions import *
from .control import *
from .data import *
from .models import *

from .core.client.models import (
    IndexModel,
)

from .utils import __version__