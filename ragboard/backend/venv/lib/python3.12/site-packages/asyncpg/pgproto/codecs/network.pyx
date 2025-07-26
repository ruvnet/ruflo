# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


import ipaddress


# defined in postgresql/src/include/inet.h
#
DEF PGSQL_AF_INET = 2  # AF_INET
DEF PGSQL_AF_INET6 = 3  # AF_INET + 1


_ipaddr = ipaddress.ip_address
_ipiface = ipaddress.ip_interface
_ipnet = ipaddress.ip_network


cdef inline uint8_t _ip_max_prefix_len(int32_t family):
    # Maximum number of bits in the network prefix of the specified
    # IP protocol version.
    if family == PGSQL_AF_INET:
        return 32
    else:
        return 128


cdef inline int32_t _ip_addr_len(int32_t family):
    # Length of address in bytes for the specified IP protocol version.
    if family == PGSQL_AF_INET:
        return 4
    else:
        return 16


cdef inline int8_t _ver_to_family(int32_t version):
    if version == 4:
        return PGSQL_AF_INET
    else:
        return PGSQL_AF_INET6


cdef inline _net_encode(WriteBuffer buf, int8_t family, uint32_t bits,
                        int8_t is_cidr, bytes addr):

    cdef:
        char *addrbytes
        ssize_t addrlen

    cpython.PyBytes_AsStringAndSize(addr, &addrbytes, &addrlen)

    buf.write_int32(4 + <int32_t>addrlen)
    buf.write_byte(family)
    buf.write_byte(<int8_t>bits)
    buf.write_byte(is_cidr)
    buf.write_byte(<int8_t>addrlen)
    buf.write_cstr(addrbytes, addrlen)


cdef net_decode(CodecContext settings, FRBuffer *buf, bint as_cidr):
    cdef:
        int32_t family = <int32_t>frb_read(buf, 1)[0]
        uint8_t bits = <uint8_t>frb_read(buf, 1)[0]
        int prefix_len
        int32_t is_cidr = <int32_t>frb_read(buf, 1)[0]
        int32_t addrlen = <int32_t>frb_read(buf, 1)[0]
        bytes addr
        uint8_t max_prefix_len = _ip_max_prefix_len(family)

    if is_cidr != as_cidr:
        raise ValueError('unexpected CIDR flag set in non-cidr value')

    if family != PGSQL_AF_INET and family != PGSQL_AF_INET6:
        raise ValueError('invalid address family in "{}" value'.format(
            'cidr' if is_cidr else 'inet'
        ))

    max_prefix_len = _ip_max_prefix_len(family)

    if bits > max_prefix_len:
        raise ValueError('invalid network prefix length in "{}" value'.format(
            'cidr' if is_cidr else 'inet'
        ))

    if addrlen != _ip_addr_len(family):
        raise ValueError('invalid address length in "{}" value'.format(
            'cidr' if is_cidr else 'inet'
        ))

    addr = cpython.PyBytes_FromStringAndSize(frb_read(buf, addrlen), addrlen)

    if as_cidr or bits != max_prefix_len:
        prefix_len = cpython.PyLong_FromLong(bits)

        if as_cidr:
            return _ipnet((addr, prefix_len))
        else:
            return _ipiface((addr, prefix_len))
    else:
        return _ipaddr(addr)


cdef cidr_encode(CodecContext settings, WriteBuffer buf, obj):
    cdef:
        object ipnet
        int8_t family

    ipnet = _ipnet(obj)
    family = _ver_to_family(ipnet.version)
    _net_encode(buf, family, ipnet.prefixlen, 1, ipnet.network_address.packed)


cdef cidr_decode(CodecContext settings, FRBuffer *buf):
    return net_decode(settings, buf, True)


cdef inet_encode(CodecContext settings, WriteBuffer buf, obj):
    cdef:
        object ipaddr
        int8_t family

    try:
        ipaddr = _ipaddr(obj)
    except ValueError:
        # PostgreSQL accepts *both* CIDR and host values
        # for the host datatype.
        ipaddr = _ipiface(obj)
        family = _ver_to_family(ipaddr.version)
        _net_encode(buf, family, ipaddr.network.prefixlen, 1, ipaddr.packed)
    else:
        family = _ver_to_family(ipaddr.version)
        _net_encode(buf, family, _ip_max_prefix_len(family), 0, ipaddr.packed)


cdef inet_decode(CodecContext settings, FRBuffer *buf):
    return net_decode(settings, buf, False)
