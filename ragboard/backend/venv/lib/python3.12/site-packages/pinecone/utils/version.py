from pathlib import Path

def get_version():
    return Path(__file__).parent.parent.joinpath("__version__").read_text().strip()

__version__ = get_version()