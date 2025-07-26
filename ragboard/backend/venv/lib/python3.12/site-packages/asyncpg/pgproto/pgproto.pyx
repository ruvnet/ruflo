# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cimport cython
cimport cpython

from . cimport cpythonx

from libc.stdint cimport int8_t, uint8_t, int16_t, uint16_t, \
                         int32_t, uint32_t, int64_t, uint64_t, \
                         INT16_MIN, INT16_MAX, INT32_MIN, INT32_MAX, \
                         UINT32_MAX, INT64_MIN, INT64_MAX, UINT64_MAX


from . cimport hton
from . cimport tohex

from .debug cimport PG_DEBUG
from . import types as pgproto_types


include "./consts.pxi"
include "./frb.pyx"
include "./buffer.pyx"
include "./uuid.pyx"

include "./codecs/context.pyx"

include "./codecs/bytea.pyx"
include "./codecs/text.pyx"

include "./codecs/datetime.pyx"
include "./codecs/float.pyx"
include "./codecs/int.pyx"
include "./codecs/json.pyx"
include "./codecs/jsonpath.pyx"
include "./codecs/uuid.pyx"
include "./codecs/numeric.pyx"
include "./codecs/bits.pyx"
include "./codecs/geometry.pyx"
include "./codecs/hstore.pyx"
include "./codecs/misc.pyx"
include "./codecs/network.pyx"
include "./codecs/tid.pyx"
include "./codecs/pg_snapshot.pyx"
