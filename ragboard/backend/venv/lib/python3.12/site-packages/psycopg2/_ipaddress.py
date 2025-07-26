"""Implementation of the ipaddres-based network types adaptation
"""

# psycopg/_ipaddress.py - Ipaddres-based network types adaptation
#
# Copyright (C) 2016-2019 Daniele Varrazzo  <daniele.varrazzo@gmail.com>
# Copyright (C) 2020-2021 The Psycopg Team
#
# psycopg2 is free software: you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# In addition, as a special exception, the copyright holders give
# permission to link this program with the OpenSSL library (or with
# modified versions of OpenSSL that use the same license as OpenSSL),
# and distribute linked combinations including the two.
#
# You must obey the GNU Lesser General Public License in all respects for
# all of the code used other than OpenSSL.
#
# psycopg2 is distributed in the hope that it will be useful, but WITHOUT
# ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
# FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public
# License for more details.

from psycopg2.extensions import (
    new_type, new_array_type, register_type, register_adapter, QuotedString)

# The module is imported on register_ipaddress
ipaddress = None

# The typecasters are created only once
_casters = None


def register_ipaddress(conn_or_curs=None):
    """
    Register conversion support between `ipaddress` objects and `network types`__.

    :param conn_or_curs: the scope where to register the type casters.
        If `!None` register them globally.

    After the function is called, PostgreSQL :sql:`inet` values will be
    converted into `~ipaddress.IPv4Interface` or `~ipaddress.IPv6Interface`
    objects, :sql:`cidr` values into into `~ipaddress.IPv4Network` or
    `~ipaddress.IPv6Network`.

    .. __: https://www.postgresql.org/docs/current/static/datatype-net-types.html
    """
    global ipaddress
    import ipaddress

    global _casters
    if _casters is None:
        _casters = _make_casters()

    for c in _casters:
        register_type(c, conn_or_curs)

    for t in [ipaddress.IPv4Interface, ipaddress.IPv6Interface,
              ipaddress.IPv4Network, ipaddress.IPv6Network]:
        register_adapter(t, adapt_ipaddress)


def _make_casters():
    inet = new_type((869,), 'INET', cast_interface)
    ainet = new_array_type((1041,), 'INET[]', inet)

    cidr = new_type((650,), 'CIDR', cast_network)
    acidr = new_array_type((651,), 'CIDR[]', cidr)

    return [inet, ainet, cidr, acidr]


def cast_interface(s, cur=None):
    if s is None:
        return None
    # Py2 version force the use of unicode. meh.
    return ipaddress.ip_interface(str(s))


def cast_network(s, cur=None):
    if s is None:
        return None
    return ipaddress.ip_network(str(s))


def adapt_ipaddress(obj):
    return QuotedString(str(obj))
