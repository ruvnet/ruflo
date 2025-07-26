# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


DEF _MAXINT32 = 2**31 - 1
DEF _COPY_BUFFER_SIZE = 524288
DEF _COPY_SIGNATURE = b"PGCOPY\n\377\r\n\0"
DEF _EXECUTE_MANY_BUF_NUM = 4
DEF _EXECUTE_MANY_BUF_SIZE = 32768
