from typing import Optional
import warnings

def warn_deprecated(description: str, deprecated_in: str, removal_in: str):
    message = f"DEPRECATED since v{deprecated_in} [Will be removed in v{removal_in}]: {description}"
    warnings.warn(message, FutureWarning)