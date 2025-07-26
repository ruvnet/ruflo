# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


from asyncpg import exceptions


@cython.final
cdef class ConnectionSettings(pgproto.CodecContext):

    def __cinit__(self, conn_key):
        self._encoding = 'utf-8'
        self._is_utf8 = True
        self._settings = {}
        self._codec = codecs.lookup('utf-8')
        self._data_codecs = DataCodecConfig(conn_key)

    cdef add_setting(self, str name, str val):
        self._settings[name] = val
        if name == 'client_encoding':
            py_enc = get_python_encoding(val)
            self._codec = codecs.lookup(py_enc)
            self._encoding = self._codec.name
            self._is_utf8 = self._encoding == 'utf-8'

    cdef is_encoding_utf8(self):
        return self._is_utf8

    cpdef get_text_codec(self):
        return self._codec

    cpdef inline register_data_types(self, types):
        self._data_codecs.add_types(types)

    cpdef inline add_python_codec(self, typeoid, typename, typeschema,
                                  typeinfos, typekind, encoder, decoder,
                                  format):
        cdef:
            ServerDataFormat _format
            ClientExchangeFormat xformat

        if format == 'binary':
            _format = PG_FORMAT_BINARY
            xformat = PG_XFORMAT_OBJECT
        elif format == 'text':
            _format = PG_FORMAT_TEXT
            xformat = PG_XFORMAT_OBJECT
        elif format == 'tuple':
            _format = PG_FORMAT_ANY
            xformat = PG_XFORMAT_TUPLE
        else:
            raise exceptions.InterfaceError(
                'invalid `format` argument, expected {}, got {!r}'.format(
                    "'text', 'binary' or 'tuple'", format
                ))

        self._data_codecs.add_python_codec(typeoid, typename, typeschema,
                                           typekind, typeinfos,
                                           encoder, decoder,
                                           _format, xformat)

    cpdef inline remove_python_codec(self, typeoid, typename, typeschema):
        self._data_codecs.remove_python_codec(typeoid, typename, typeschema)

    cpdef inline clear_type_cache(self):
        self._data_codecs.clear_type_cache()

    cpdef inline set_builtin_type_codec(self, typeoid, typename, typeschema,
                                        typekind, alias_to, format):
        cdef:
            ServerDataFormat _format

        if format is None:
            _format = PG_FORMAT_ANY
        elif format == 'binary':
            _format = PG_FORMAT_BINARY
        elif format == 'text':
            _format = PG_FORMAT_TEXT
        else:
            raise exceptions.InterfaceError(
                'invalid `format` argument, expected {}, got {!r}'.format(
                    "'text' or 'binary'", format
                ))

        self._data_codecs.set_builtin_type_codec(typeoid, typename, typeschema,
                                                 typekind, alias_to, _format)

    cpdef inline Codec get_data_codec(self, uint32_t oid,
                                      ServerDataFormat format=PG_FORMAT_ANY,
                                      bint ignore_custom_codec=False):
        return self._data_codecs.get_codec(oid, format, ignore_custom_codec)

    def __getattr__(self, name):
        if not name.startswith('_'):
            try:
                return self._settings[name]
            except KeyError:
                raise AttributeError(name) from None

        return object.__getattribute__(self, name)

    def __repr__(self):
        return '<ConnectionSettings {!r}>'.format(self._settings)
