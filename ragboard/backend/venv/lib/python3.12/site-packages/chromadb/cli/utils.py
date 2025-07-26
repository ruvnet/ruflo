from typing import Any, Dict

import os
import yaml


def set_log_file_path(
    log_config_path: str, new_filename: str = "chroma.log"
) -> Dict[str, Any]:
    """This works with the standard log_config.yml file.
    It will not work with custom log configs that may use different handlers"""
    with open(f"{log_config_path}", "r") as file:
        log_config = yaml.safe_load(file)
    for handler in log_config["handlers"].values():
        if handler.get("class") == "logging.handlers.RotatingFileHandler":
            handler["filename"] = new_filename

    return log_config


def get_directory_size(directory: str) -> int:
    """Get the size of a directory in bytes"""
    total = 0
    with os.scandir(directory) as it:
        for entry in it:
            if entry.is_file():
                total += entry.stat().st_size
            elif entry.is_dir():
                total += get_directory_size(entry.path)
    return total


# https://stackoverflow.com/a/1094933
def sizeof_fmt(num: int, suffix: str = "B") -> str:
    n: float = float(num)
    for unit in ("", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei", "Zi"):
        if abs(n) < 1024.0:
            return f"{n:3.1f}{unit}{suffix}"
        n /= 1024.0
    return f"{n:.1f}Yi{suffix}"
