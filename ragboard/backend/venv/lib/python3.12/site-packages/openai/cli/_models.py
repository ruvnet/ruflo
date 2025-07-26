from typing import Any
from typing_extensions import ClassVar

import pydantic

from .. import _models
from .._compat import PYDANTIC_V2, ConfigDict


class BaseModel(_models.BaseModel):
    if PYDANTIC_V2:
        model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", arbitrary_types_allowed=True)
    else:

        class Config(pydantic.BaseConfig):  # type: ignore
            extra: Any = pydantic.Extra.ignore  # type: ignore
            arbitrary_types_allowed: bool = True
