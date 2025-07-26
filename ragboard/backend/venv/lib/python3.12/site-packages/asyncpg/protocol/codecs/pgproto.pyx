# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef init_bits_codecs():
    register_core_codec(BITOID,
                        <encode_func>pgproto.bits_encode,
                        <decode_func>pgproto.bits_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(VARBITOID,
                        <encode_func>pgproto.bits_encode,
                        <decode_func>pgproto.bits_decode,
                        PG_FORMAT_BINARY)


cdef init_bytea_codecs():
    register_core_codec(BYTEAOID,
                        <encode_func>pgproto.bytea_encode,
                        <decode_func>pgproto.bytea_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(CHAROID,
                        <encode_func>pgproto.bytea_encode,
                        <decode_func>pgproto.bytea_decode,
                        PG_FORMAT_BINARY)


cdef init_datetime_codecs():
    register_core_codec(DATEOID,
                        <encode_func>pgproto.date_encode,
                        <decode_func>pgproto.date_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(DATEOID,
                        <encode_func>pgproto.date_encode_tuple,
                        <decode_func>pgproto.date_decode_tuple,
                        PG_FORMAT_BINARY,
                        PG_XFORMAT_TUPLE)

    register_core_codec(TIMEOID,
                        <encode_func>pgproto.time_encode,
                        <decode_func>pgproto.time_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(TIMEOID,
                        <encode_func>pgproto.time_encode_tuple,
                        <decode_func>pgproto.time_decode_tuple,
                        PG_FORMAT_BINARY,
                        PG_XFORMAT_TUPLE)

    register_core_codec(TIMETZOID,
                        <encode_func>pgproto.timetz_encode,
                        <decode_func>pgproto.timetz_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(TIMETZOID,
                        <encode_func>pgproto.timetz_encode_tuple,
                        <decode_func>pgproto.timetz_decode_tuple,
                        PG_FORMAT_BINARY,
                        PG_XFORMAT_TUPLE)

    register_core_codec(TIMESTAMPOID,
                        <encode_func>pgproto.timestamp_encode,
                        <decode_func>pgproto.timestamp_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(TIMESTAMPOID,
                        <encode_func>pgproto.timestamp_encode_tuple,
                        <decode_func>pgproto.timestamp_decode_tuple,
                        PG_FORMAT_BINARY,
                        PG_XFORMAT_TUPLE)

    register_core_codec(TIMESTAMPTZOID,
                        <encode_func>pgproto.timestamptz_encode,
                        <decode_func>pgproto.timestamptz_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(TIMESTAMPTZOID,
                        <encode_func>pgproto.timestamp_encode_tuple,
                        <decode_func>pgproto.timestamp_decode_tuple,
                        PG_FORMAT_BINARY,
                        PG_XFORMAT_TUPLE)

    register_core_codec(INTERVALOID,
                        <encode_func>pgproto.interval_encode,
                        <decode_func>pgproto.interval_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(INTERVALOID,
                        <encode_func>pgproto.interval_encode_tuple,
                        <decode_func>pgproto.interval_decode_tuple,
                        PG_FORMAT_BINARY,
                        PG_XFORMAT_TUPLE)

    # For obsolete abstime/reltime/tinterval, we do not bother to
    # interpret the value, and simply return and pass it as text.
    #
    register_core_codec(ABSTIMEOID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    register_core_codec(RELTIMEOID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    register_core_codec(TINTERVALOID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)


cdef init_float_codecs():
    register_core_codec(FLOAT4OID,
                        <encode_func>pgproto.float4_encode,
                        <decode_func>pgproto.float4_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(FLOAT8OID,
                        <encode_func>pgproto.float8_encode,
                        <decode_func>pgproto.float8_decode,
                        PG_FORMAT_BINARY)


cdef init_geometry_codecs():
    register_core_codec(BOXOID,
                        <encode_func>pgproto.box_encode,
                        <decode_func>pgproto.box_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(LINEOID,
                        <encode_func>pgproto.line_encode,
                        <decode_func>pgproto.line_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(LSEGOID,
                        <encode_func>pgproto.lseg_encode,
                        <decode_func>pgproto.lseg_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(POINTOID,
                        <encode_func>pgproto.point_encode,
                        <decode_func>pgproto.point_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(PATHOID,
                        <encode_func>pgproto.path_encode,
                        <decode_func>pgproto.path_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(POLYGONOID,
                        <encode_func>pgproto.poly_encode,
                        <decode_func>pgproto.poly_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(CIRCLEOID,
                        <encode_func>pgproto.circle_encode,
                        <decode_func>pgproto.circle_decode,
                        PG_FORMAT_BINARY)


cdef init_hstore_codecs():
    register_extra_codec('pg_contrib.hstore',
                         <encode_func>pgproto.hstore_encode,
                         <decode_func>pgproto.hstore_decode,
                         PG_FORMAT_BINARY)


cdef init_json_codecs():
    register_core_codec(JSONOID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_BINARY)
    register_core_codec(JSONBOID,
                        <encode_func>pgproto.jsonb_encode,
                        <decode_func>pgproto.jsonb_decode,
                        PG_FORMAT_BINARY)
    register_core_codec(JSONPATHOID,
                        <encode_func>pgproto.jsonpath_encode,
                        <decode_func>pgproto.jsonpath_decode,
                        PG_FORMAT_BINARY)


cdef init_int_codecs():

    register_core_codec(BOOLOID,
                        <encode_func>pgproto.bool_encode,
                        <decode_func>pgproto.bool_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(INT2OID,
                        <encode_func>pgproto.int2_encode,
                        <decode_func>pgproto.int2_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(INT4OID,
                        <encode_func>pgproto.int4_encode,
                        <decode_func>pgproto.int4_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(INT8OID,
                        <encode_func>pgproto.int8_encode,
                        <decode_func>pgproto.int8_decode,
                        PG_FORMAT_BINARY)


cdef init_pseudo_codecs():
    # Void type is returned by SELECT void_returning_function()
    register_core_codec(VOIDOID,
                        <encode_func>pgproto.void_encode,
                        <decode_func>pgproto.void_decode,
                        PG_FORMAT_BINARY)

    # Unknown type, always decoded as text
    register_core_codec(UNKNOWNOID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    # OID and friends
    oid_types = [
        OIDOID, XIDOID, CIDOID
    ]

    for oid_type in oid_types:
        register_core_codec(oid_type,
                            <encode_func>pgproto.uint4_encode,
                            <decode_func>pgproto.uint4_decode,
                            PG_FORMAT_BINARY)

    # 64-bit OID types
    oid8_types = [
        XID8OID,
    ]

    for oid_type in oid8_types:
        register_core_codec(oid_type,
                            <encode_func>pgproto.uint8_encode,
                            <decode_func>pgproto.uint8_decode,
                            PG_FORMAT_BINARY)

    # reg* types -- these are really system catalog OIDs, but
    # allow the catalog object name as an input.  We could just
    # decode these as OIDs, but handling them as text seems more
    # useful.
    #
    reg_types = [
        REGPROCOID, REGPROCEDUREOID, REGOPEROID, REGOPERATOROID,
        REGCLASSOID, REGTYPEOID, REGCONFIGOID, REGDICTIONARYOID,
        REGNAMESPACEOID, REGROLEOID, REFCURSOROID, REGCOLLATIONOID,
    ]

    for reg_type in reg_types:
        register_core_codec(reg_type,
                            <encode_func>pgproto.text_encode,
                            <decode_func>pgproto.text_decode,
                            PG_FORMAT_TEXT)

    # cstring type is used by Postgres' I/O functions
    register_core_codec(CSTRINGOID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_BINARY)

    # various system pseudotypes with no I/O
    no_io_types = [
        ANYOID, TRIGGEROID, EVENT_TRIGGEROID, LANGUAGE_HANDLEROID,
        FDW_HANDLEROID, TSM_HANDLEROID, INTERNALOID, OPAQUEOID,
        ANYELEMENTOID, ANYNONARRAYOID, ANYCOMPATIBLEOID,
        ANYCOMPATIBLEARRAYOID, ANYCOMPATIBLENONARRAYOID,
        ANYCOMPATIBLERANGEOID, ANYCOMPATIBLEMULTIRANGEOID,
        ANYRANGEOID, ANYMULTIRANGEOID, ANYARRAYOID,
        PG_DDL_COMMANDOID, INDEX_AM_HANDLEROID, TABLE_AM_HANDLEROID,
    ]

    register_core_codec(ANYENUMOID,
                        NULL,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    for no_io_type in no_io_types:
        register_core_codec(no_io_type,
                            NULL,
                            NULL,
                            PG_FORMAT_BINARY)

    # ACL specification string
    register_core_codec(ACLITEMOID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    # Postgres' serialized expression tree type
    register_core_codec(PG_NODE_TREEOID,
                        NULL,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    # pg_lsn type -- a pointer to a location in the XLOG.
    register_core_codec(PG_LSNOID,
                        <encode_func>pgproto.int8_encode,
                        <decode_func>pgproto.int8_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(SMGROID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    # pg_dependencies and pg_ndistinct are special types
    # used in pg_statistic_ext columns.
    register_core_codec(PG_DEPENDENCIESOID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    register_core_codec(PG_NDISTINCTOID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    # pg_mcv_list is a special type used in pg_statistic_ext_data
    # system catalog
    register_core_codec(PG_MCV_LISTOID,
                        <encode_func>pgproto.bytea_encode,
                        <decode_func>pgproto.bytea_decode,
                        PG_FORMAT_BINARY)

    # These two are internal to BRIN index support and are unlikely
    # to be sent, but since I/O functions for these exist, add decoders
    # nonetheless.
    register_core_codec(PG_BRIN_BLOOM_SUMMARYOID,
                        NULL,
                        <decode_func>pgproto.bytea_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(PG_BRIN_MINMAX_MULTI_SUMMARYOID,
                        NULL,
                        <decode_func>pgproto.bytea_decode,
                        PG_FORMAT_BINARY)


cdef init_text_codecs():
    textoids = [
        NAMEOID,
        BPCHAROID,
        VARCHAROID,
        TEXTOID,
        XMLOID
    ]

    for oid in textoids:
        register_core_codec(oid,
                            <encode_func>pgproto.text_encode,
                            <decode_func>pgproto.text_decode,
                            PG_FORMAT_BINARY)

        register_core_codec(oid,
                            <encode_func>pgproto.text_encode,
                            <decode_func>pgproto.text_decode,
                            PG_FORMAT_TEXT)


cdef init_tid_codecs():
    register_core_codec(TIDOID,
                        <encode_func>pgproto.tid_encode,
                        <decode_func>pgproto.tid_decode,
                        PG_FORMAT_BINARY)


cdef init_txid_codecs():
    register_core_codec(TXID_SNAPSHOTOID,
                        <encode_func>pgproto.pg_snapshot_encode,
                        <decode_func>pgproto.pg_snapshot_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(PG_SNAPSHOTOID,
                        <encode_func>pgproto.pg_snapshot_encode,
                        <decode_func>pgproto.pg_snapshot_decode,
                        PG_FORMAT_BINARY)


cdef init_tsearch_codecs():
    ts_oids = [
        TSQUERYOID,
        TSVECTOROID,
    ]

    for oid in ts_oids:
        register_core_codec(oid,
                            <encode_func>pgproto.text_encode,
                            <decode_func>pgproto.text_decode,
                            PG_FORMAT_TEXT)

    register_core_codec(GTSVECTOROID,
                        NULL,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)


cdef init_uuid_codecs():
    register_core_codec(UUIDOID,
                        <encode_func>pgproto.uuid_encode,
                        <decode_func>pgproto.uuid_decode,
                        PG_FORMAT_BINARY)


cdef init_numeric_codecs():
    register_core_codec(NUMERICOID,
                        <encode_func>pgproto.numeric_encode_text,
                        <decode_func>pgproto.numeric_decode_text,
                        PG_FORMAT_TEXT)

    register_core_codec(NUMERICOID,
                        <encode_func>pgproto.numeric_encode_binary,
                        <decode_func>pgproto.numeric_decode_binary,
                        PG_FORMAT_BINARY)


cdef init_network_codecs():
    register_core_codec(CIDROID,
                        <encode_func>pgproto.cidr_encode,
                        <decode_func>pgproto.cidr_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(INETOID,
                        <encode_func>pgproto.inet_encode,
                        <decode_func>pgproto.inet_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(MACADDROID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)

    register_core_codec(MACADDR8OID,
                        <encode_func>pgproto.text_encode,
                        <decode_func>pgproto.text_decode,
                        PG_FORMAT_TEXT)


cdef init_monetary_codecs():
    moneyoids = [
        MONEYOID,
    ]

    for oid in moneyoids:
        register_core_codec(oid,
                            <encode_func>pgproto.text_encode,
                            <decode_func>pgproto.text_decode,
                            PG_FORMAT_TEXT)


cdef init_all_pgproto_codecs():
    # Builtin types, in lexicographical order.
    init_bits_codecs()
    init_bytea_codecs()
    init_datetime_codecs()
    init_float_codecs()
    init_geometry_codecs()
    init_int_codecs()
    init_json_codecs()
    init_monetary_codecs()
    init_network_codecs()
    init_numeric_codecs()
    init_text_codecs()
    init_tid_codecs()
    init_tsearch_codecs()
    init_txid_codecs()
    init_uuid_codecs()

    # Various pseudotypes and system types
    init_pseudo_codecs()

    # contrib
    init_hstore_codecs()


init_all_pgproto_codecs()
