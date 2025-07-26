# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

import dns.immutable
import dns.rdtypes.txtbase


@dns.immutable.immutable
class WALLET(dns.rdtypes.txtbase.TXTBase):
    """WALLET record"""
