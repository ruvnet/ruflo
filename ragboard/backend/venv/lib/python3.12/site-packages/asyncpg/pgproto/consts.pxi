# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


DEF _BUFFER_INITIAL_SIZE = 1024
DEF _BUFFER_MAX_GROW = 65536
DEF _BUFFER_FREELIST_SIZE = 256
DEF _MAXINT32 = 2**31 - 1
DEF _NUMERIC_DECODER_SMALLBUF_SIZE = 256
