# engine/processors.py
# Copyright (C) 2010-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
# Copyright (C) 2010 Gaetan de Menten gdementen@gmail.com
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""defines generic type conversion functions, as used in bind and result
processors.

They all share one common characteristic: None is passed through unchanged.

"""
from __future__ import annotations

import typing

from ._py_processors import str_to_datetime_processor_factory  # noqa
from ..util._has_cy import HAS_CYEXTENSION

if typing.TYPE_CHECKING or not HAS_CYEXTENSION:
    from ._py_processors import int_to_boolean as int_to_boolean
    from ._py_processors import str_to_date as str_to_date
    from ._py_processors import str_to_datetime as str_to_datetime
    from ._py_processors import str_to_time as str_to_time
    from ._py_processors import (
        to_decimal_processor_factory as to_decimal_processor_factory,
    )
    from ._py_processors import to_float as to_float
    from ._py_processors import to_str as to_str
else:
    from sqlalchemy.cyextension.processors import (
        DecimalResultProcessor,
    )
    from sqlalchemy.cyextension.processors import (  # noqa: F401
        int_to_boolean as int_to_boolean,
    )
    from sqlalchemy.cyextension.processors import (  # noqa: F401,E501
        str_to_date as str_to_date,
    )
    from sqlalchemy.cyextension.processors import (  # noqa: F401
        str_to_datetime as str_to_datetime,
    )
    from sqlalchemy.cyextension.processors import (  # noqa: F401,E501
        str_to_time as str_to_time,
    )
    from sqlalchemy.cyextension.processors import (  # noqa: F401,E501
        to_float as to_float,
    )
    from sqlalchemy.cyextension.processors import (  # noqa: F401,E501
        to_str as to_str,
    )

    def to_decimal_processor_factory(target_class, scale):
        # Note that the scale argument is not taken into account for integer
        # values in the C implementation while it is in the Python one.
        # For example, the Python implementation might return
        # Decimal('5.00000') whereas the C implementation will
        # return Decimal('5'). These are equivalent of course.
        return DecimalResultProcessor(target_class, "%%.%df" % scale).process
