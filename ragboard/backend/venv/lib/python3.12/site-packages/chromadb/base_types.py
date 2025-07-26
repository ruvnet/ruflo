from typing import Dict, List, Mapping, Optional, Sequence, Union
from typing_extensions import Literal
import numpy as np
from numpy.typing import NDArray

Metadata = Mapping[str, Optional[Union[str, int, float, bool]]]
UpdateMetadata = Mapping[str, Union[int, float, str, bool, None]]
PyVector = Union[Sequence[float], Sequence[int]]
Vector = NDArray[Union[np.int32, np.float32]]  # TODO: Specify that the vector is 1D
# Metadata Query Grammar
LiteralValue = Union[str, int, float, bool]
LogicalOperator = Union[Literal["$and"], Literal["$or"]]
WhereOperator = Union[
    Literal["$gt"],
    Literal["$gte"],
    Literal["$lt"],
    Literal["$lte"],
    Literal["$ne"],
    Literal["$eq"],
]
InclusionExclusionOperator = Union[Literal["$in"], Literal["$nin"]]
OperatorExpression = Union[
    Dict[Union[WhereOperator, LogicalOperator], LiteralValue],
    Dict[InclusionExclusionOperator, List[LiteralValue]],
]

Where = Dict[
    Union[str, LogicalOperator], Union[LiteralValue, OperatorExpression, List["Where"]]
]

WhereDocumentOperator = Union[
    Literal["$contains"],
    Literal["$not_contains"],
    Literal["$regex"],
    Literal["$not_regex"],
    LogicalOperator,
]
WhereDocument = Dict[WhereDocumentOperator, Union[str, List["WhereDocument"]]]
