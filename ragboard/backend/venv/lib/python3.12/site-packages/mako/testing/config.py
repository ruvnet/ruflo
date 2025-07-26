from dataclasses import dataclass
from pathlib import Path

from ._config import ReadsCfg
from .helpers import make_path


@dataclass
class Config(ReadsCfg):
    module_base: Path
    template_base: Path

    section_header = "mako_testing"
    converters = {Path: make_path}


config = Config.from_cfg_file("./setup.cfg")
