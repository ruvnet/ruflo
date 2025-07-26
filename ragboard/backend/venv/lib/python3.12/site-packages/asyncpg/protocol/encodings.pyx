# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


'''Map PostgreSQL encoding names to Python encoding names

https://www.postgresql.org/docs/current/static/multibyte.html#CHARSET-TABLE
'''

cdef dict ENCODINGS_MAP = {
    'abc': 'cp1258',
    'alt': 'cp866',
    'euc_cn': 'euccn',
    'euc_jp': 'eucjp',
    'euc_kr': 'euckr',
    'koi8r': 'koi8_r',
    'koi8u': 'koi8_u',
    'shift_jis_2004': 'euc_jis_2004',
    'sjis': 'shift_jis',
    'sql_ascii': 'ascii',
    'vscii': 'cp1258',
    'tcvn': 'cp1258',
    'tcvn5712': 'cp1258',
    'unicode': 'utf_8',
    'win': 'cp1521',
    'win1250': 'cp1250',
    'win1251': 'cp1251',
    'win1252': 'cp1252',
    'win1253': 'cp1253',
    'win1254': 'cp1254',
    'win1255': 'cp1255',
    'win1256': 'cp1256',
    'win1257': 'cp1257',
    'win1258': 'cp1258',
    'win866': 'cp866',
    'win874': 'cp874',
    'win932': 'cp932',
    'win936': 'cp936',
    'win949': 'cp949',
    'win950': 'cp950',
    'windows1250': 'cp1250',
    'windows1251': 'cp1251',
    'windows1252': 'cp1252',
    'windows1253': 'cp1253',
    'windows1254': 'cp1254',
    'windows1255': 'cp1255',
    'windows1256': 'cp1256',
    'windows1257': 'cp1257',
    'windows1258': 'cp1258',
    'windows866': 'cp866',
    'windows874': 'cp874',
    'windows932': 'cp932',
    'windows936': 'cp936',
    'windows949': 'cp949',
    'windows950': 'cp950',
}


cdef get_python_encoding(pg_encoding):
    return ENCODINGS_MAP.get(pg_encoding.lower(), pg_encoding.lower())
