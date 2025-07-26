# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

# Copyright (C) 2003-2017 Nominum, Inc.
#
# Permission to use, copy, modify, and distribute this software and its
# documentation for any purpose with or without fee is hereby granted,
# provided that the above copyright notice and this permission notice
# appear in all copies.
#
# THE SOFTWARE IS PROVIDED "AS IS" AND NOMINUM DISCLAIMS ALL WARRANTIES
# WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
# MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL NOMINUM BE LIABLE FOR
# ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
# WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
# ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
# OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

"""Asynchronous DNS stub resolver."""

import socket
import time
from typing import Any, Dict, List, Optional, Union

import dns._ddr
import dns.asyncbackend
import dns.asyncquery
import dns.exception
import dns.name
import dns.query
import dns.rdataclass
import dns.rdatatype
import dns.resolver  # lgtm[py/import-and-import-from]

# import some resolver symbols for brevity
from dns.resolver import NXDOMAIN, NoAnswer, NoRootSOA, NotAbsolute

# for indentation purposes below
_udp = dns.asyncquery.udp
_tcp = dns.asyncquery.tcp


class Resolver(dns.resolver.BaseResolver):
    """Asynchronous DNS stub resolver."""

    async def resolve(
        self,
        qname: Union[dns.name.Name, str],
        rdtype: Union[dns.rdatatype.RdataType, str] = dns.rdatatype.A,
        rdclass: Union[dns.rdataclass.RdataClass, str] = dns.rdataclass.IN,
        tcp: bool = False,
        source: Optional[str] = None,
        raise_on_no_answer: bool = True,
        source_port: int = 0,
        lifetime: Optional[float] = None,
        search: Optional[bool] = None,
        backend: Optional[dns.asyncbackend.Backend] = None,
    ) -> dns.resolver.Answer:
        """Query nameservers asynchronously to find the answer to the question.

        *backend*, a ``dns.asyncbackend.Backend``, or ``None``.  If ``None``,
        the default, then dnspython will use the default backend.

        See :py:func:`dns.resolver.Resolver.resolve()` for the
        documentation of the other parameters, exceptions, and return
        type of this method.
        """

        resolution = dns.resolver._Resolution(
            self, qname, rdtype, rdclass, tcp, raise_on_no_answer, search
        )
        if not backend:
            backend = dns.asyncbackend.get_default_backend()
        start = time.time()
        while True:
            (request, answer) = resolution.next_request()
            # Note we need to say "if answer is not None" and not just
            # "if answer" because answer implements __len__, and python
            # will call that.  We want to return if we have an answer
            # object, including in cases where its length is 0.
            if answer is not None:
                # cache hit!
                return answer
            assert request is not None  # needed for type checking
            done = False
            while not done:
                (nameserver, tcp, backoff) = resolution.next_nameserver()
                if backoff:
                    await backend.sleep(backoff)
                timeout = self._compute_timeout(start, lifetime, resolution.errors)
                try:
                    response = await nameserver.async_query(
                        request,
                        timeout=timeout,
                        source=source,
                        source_port=source_port,
                        max_size=tcp,
                        backend=backend,
                    )
                except Exception as ex:
                    (_, done) = resolution.query_result(None, ex)
                    continue
                (answer, done) = resolution.query_result(response, None)
                # Note we need to say "if answer is not None" and not just
                # "if answer" because answer implements __len__, and python
                # will call that.  We want to return if we have an answer
                # object, including in cases where its length is 0.
                if answer is not None:
                    return answer

    async def resolve_address(
        self, ipaddr: str, *args: Any, **kwargs: Any
    ) -> dns.resolver.Answer:
        """Use an asynchronous resolver to run a reverse query for PTR
        records.

        This utilizes the resolve() method to perform a PTR lookup on the
        specified IP address.

        *ipaddr*, a ``str``, the IPv4 or IPv6 address you want to get
        the PTR record for.

        All other arguments that can be passed to the resolve() function
        except for rdtype and rdclass are also supported by this
        function.

        """
        # We make a modified kwargs for type checking happiness, as otherwise
        # we get a legit warning about possibly having rdtype and rdclass
        # in the kwargs more than once.
        modified_kwargs: Dict[str, Any] = {}
        modified_kwargs.update(kwargs)
        modified_kwargs["rdtype"] = dns.rdatatype.PTR
        modified_kwargs["rdclass"] = dns.rdataclass.IN
        return await self.resolve(
            dns.reversename.from_address(ipaddr), *args, **modified_kwargs
        )

    async def resolve_name(
        self,
        name: Union[dns.name.Name, str],
        family: int = socket.AF_UNSPEC,
        **kwargs: Any,
    ) -> dns.resolver.HostAnswers:
        """Use an asynchronous resolver to query for address records.

        This utilizes the resolve() method to perform A and/or AAAA lookups on
        the specified name.

        *qname*, a ``dns.name.Name`` or ``str``, the name to resolve.

        *family*, an ``int``, the address family.  If socket.AF_UNSPEC
        (the default), both A and AAAA records will be retrieved.

        All other arguments that can be passed to the resolve() function
        except for rdtype and rdclass are also supported by this
        function.
        """
        # We make a modified kwargs for type checking happiness, as otherwise
        # we get a legit warning about possibly having rdtype and rdclass
        # in the kwargs more than once.
        modified_kwargs: Dict[str, Any] = {}
        modified_kwargs.update(kwargs)
        modified_kwargs.pop("rdtype", None)
        modified_kwargs["rdclass"] = dns.rdataclass.IN

        if family == socket.AF_INET:
            v4 = await self.resolve(name, dns.rdatatype.A, **modified_kwargs)
            return dns.resolver.HostAnswers.make(v4=v4)
        elif family == socket.AF_INET6:
            v6 = await self.resolve(name, dns.rdatatype.AAAA, **modified_kwargs)
            return dns.resolver.HostAnswers.make(v6=v6)
        elif family != socket.AF_UNSPEC:
            raise NotImplementedError(f"unknown address family {family}")

        raise_on_no_answer = modified_kwargs.pop("raise_on_no_answer", True)
        lifetime = modified_kwargs.pop("lifetime", None)
        start = time.time()
        v6 = await self.resolve(
            name,
            dns.rdatatype.AAAA,
            raise_on_no_answer=False,
            lifetime=self._compute_timeout(start, lifetime),
            **modified_kwargs,
        )
        # Note that setting name ensures we query the same name
        # for A as we did for AAAA.  (This is just in case search lists
        # are active by default in the resolver configuration and
        # we might be talking to a server that says NXDOMAIN when it
        # wants to say NOERROR no data.
        name = v6.qname
        v4 = await self.resolve(
            name,
            dns.rdatatype.A,
            raise_on_no_answer=False,
            lifetime=self._compute_timeout(start, lifetime),
            **modified_kwargs,
        )
        answers = dns.resolver.HostAnswers.make(
            v6=v6, v4=v4, add_empty=not raise_on_no_answer
        )
        if not answers:
            raise NoAnswer(response=v6.response)
        return answers

    # pylint: disable=redefined-outer-name

    async def canonical_name(self, name: Union[dns.name.Name, str]) -> dns.name.Name:
        """Determine the canonical name of *name*.

        The canonical name is the name the resolver uses for queries
        after all CNAME and DNAME renamings have been applied.

        *name*, a ``dns.name.Name`` or ``str``, the query name.

        This method can raise any exception that ``resolve()`` can
        raise, other than ``dns.resolver.NoAnswer`` and
        ``dns.resolver.NXDOMAIN``.

        Returns a ``dns.name.Name``.
        """
        try:
            answer = await self.resolve(name, raise_on_no_answer=False)
            canonical_name = answer.canonical_name
        except dns.resolver.NXDOMAIN as e:
            canonical_name = e.canonical_name
        return canonical_name

    async def try_ddr(self, lifetime: float = 5.0) -> None:
        """Try to update the resolver's nameservers using Discovery of Designated
        Resolvers (DDR).  If successful, the resolver will subsequently use
        DNS-over-HTTPS or DNS-over-TLS for future queries.

        *lifetime*, a float, is the maximum time to spend attempting DDR.  The default
        is 5 seconds.

        If the SVCB query is successful and results in a non-empty list of nameservers,
        then the resolver's nameservers are set to the returned servers in priority
        order.

        The current implementation does not use any address hints from the SVCB record,
        nor does it resolve addresses for the SCVB target name, rather it assumes that
        the bootstrap nameserver will always be one of the addresses and uses it.
        A future revision to the code may offer fuller support.  The code verifies that
        the bootstrap nameserver is in the Subject Alternative Name field of the
        TLS certficate.
        """
        try:
            expiration = time.time() + lifetime
            answer = await self.resolve(
                dns._ddr._local_resolver_name, "svcb", lifetime=lifetime
            )
            timeout = dns.query._remaining(expiration)
            nameservers = await dns._ddr._get_nameservers_async(answer, timeout)
            if len(nameservers) > 0:
                self.nameservers = nameservers
        except Exception:
            pass


default_resolver = None


def get_default_resolver() -> Resolver:
    """Get the default asynchronous resolver, initializing it if necessary."""
    if default_resolver is None:
        reset_default_resolver()
    assert default_resolver is not None
    return default_resolver


def reset_default_resolver() -> None:
    """Re-initialize default asynchronous resolver.

    Note that the resolver configuration (i.e. /etc/resolv.conf on UNIX
    systems) will be re-read immediately.
    """

    global default_resolver
    default_resolver = Resolver()


async def resolve(
    qname: Union[dns.name.Name, str],
    rdtype: Union[dns.rdatatype.RdataType, str] = dns.rdatatype.A,
    rdclass: Union[dns.rdataclass.RdataClass, str] = dns.rdataclass.IN,
    tcp: bool = False,
    source: Optional[str] = None,
    raise_on_no_answer: bool = True,
    source_port: int = 0,
    lifetime: Optional[float] = None,
    search: Optional[bool] = None,
    backend: Optional[dns.asyncbackend.Backend] = None,
) -> dns.resolver.Answer:
    """Query nameservers asynchronously to find the answer to the question.

    This is a convenience function that uses the default resolver
    object to make the query.

    See :py:func:`dns.asyncresolver.Resolver.resolve` for more
    information on the parameters.
    """

    return await get_default_resolver().resolve(
        qname,
        rdtype,
        rdclass,
        tcp,
        source,
        raise_on_no_answer,
        source_port,
        lifetime,
        search,
        backend,
    )


async def resolve_address(
    ipaddr: str, *args: Any, **kwargs: Any
) -> dns.resolver.Answer:
    """Use a resolver to run a reverse query for PTR records.

    See :py:func:`dns.asyncresolver.Resolver.resolve_address` for more
    information on the parameters.
    """

    return await get_default_resolver().resolve_address(ipaddr, *args, **kwargs)


async def resolve_name(
    name: Union[dns.name.Name, str], family: int = socket.AF_UNSPEC, **kwargs: Any
) -> dns.resolver.HostAnswers:
    """Use a resolver to asynchronously query for address records.

    See :py:func:`dns.asyncresolver.Resolver.resolve_name` for more
    information on the parameters.
    """

    return await get_default_resolver().resolve_name(name, family, **kwargs)


async def canonical_name(name: Union[dns.name.Name, str]) -> dns.name.Name:
    """Determine the canonical name of *name*.

    See :py:func:`dns.resolver.Resolver.canonical_name` for more
    information on the parameters and possible exceptions.
    """

    return await get_default_resolver().canonical_name(name)


async def try_ddr(timeout: float = 5.0) -> None:
    """Try to update the default resolver's nameservers using Discovery of Designated
    Resolvers (DDR).  If successful, the resolver will subsequently use
    DNS-over-HTTPS or DNS-over-TLS for future queries.

    See :py:func:`dns.resolver.Resolver.try_ddr` for more information.
    """
    return await get_default_resolver().try_ddr(timeout)


async def zone_for_name(
    name: Union[dns.name.Name, str],
    rdclass: dns.rdataclass.RdataClass = dns.rdataclass.IN,
    tcp: bool = False,
    resolver: Optional[Resolver] = None,
    backend: Optional[dns.asyncbackend.Backend] = None,
) -> dns.name.Name:
    """Find the name of the zone which contains the specified name.

    See :py:func:`dns.resolver.Resolver.zone_for_name` for more
    information on the parameters and possible exceptions.
    """

    if isinstance(name, str):
        name = dns.name.from_text(name, dns.name.root)
    if resolver is None:
        resolver = get_default_resolver()
    if not name.is_absolute():
        raise NotAbsolute(name)
    while True:
        try:
            answer = await resolver.resolve(
                name, dns.rdatatype.SOA, rdclass, tcp, backend=backend
            )
            assert answer.rrset is not None
            if answer.rrset.name == name:
                return name
            # otherwise we were CNAMEd or DNAMEd and need to look higher
        except (NXDOMAIN, NoAnswer):
            pass
        try:
            name = name.parent()
        except dns.name.NoParent:  # pragma: no cover
            raise NoRootSOA


async def make_resolver_at(
    where: Union[dns.name.Name, str],
    port: int = 53,
    family: int = socket.AF_UNSPEC,
    resolver: Optional[Resolver] = None,
) -> Resolver:
    """Make a stub resolver using the specified destination as the full resolver.

    *where*, a ``dns.name.Name`` or ``str`` the domain name or IP address of the
    full resolver.

    *port*, an ``int``, the port to use.  If not specified, the default is 53.

    *family*, an ``int``, the address family to use.  This parameter is used if
    *where* is not an address.  The default is ``socket.AF_UNSPEC`` in which case
    the first address returned by ``resolve_name()`` will be used, otherwise the
    first address of the specified family will be used.

    *resolver*, a ``dns.asyncresolver.Resolver`` or ``None``, the resolver to use for
    resolution of hostnames.  If not specified, the default resolver will be used.

    Returns a ``dns.resolver.Resolver`` or raises an exception.
    """
    if resolver is None:
        resolver = get_default_resolver()
    nameservers: List[Union[str, dns.nameserver.Nameserver]] = []
    if isinstance(where, str) and dns.inet.is_address(where):
        nameservers.append(dns.nameserver.Do53Nameserver(where, port))
    else:
        answers = await resolver.resolve_name(where, family)
        for address in answers.addresses():
            nameservers.append(dns.nameserver.Do53Nameserver(address, port))
    res = dns.asyncresolver.Resolver(configure=False)
    res.nameservers = nameservers
    return res


async def resolve_at(
    where: Union[dns.name.Name, str],
    qname: Union[dns.name.Name, str],
    rdtype: Union[dns.rdatatype.RdataType, str] = dns.rdatatype.A,
    rdclass: Union[dns.rdataclass.RdataClass, str] = dns.rdataclass.IN,
    tcp: bool = False,
    source: Optional[str] = None,
    raise_on_no_answer: bool = True,
    source_port: int = 0,
    lifetime: Optional[float] = None,
    search: Optional[bool] = None,
    backend: Optional[dns.asyncbackend.Backend] = None,
    port: int = 53,
    family: int = socket.AF_UNSPEC,
    resolver: Optional[Resolver] = None,
) -> dns.resolver.Answer:
    """Query nameservers to find the answer to the question.

    This is a convenience function that calls ``dns.asyncresolver.make_resolver_at()``
    to make a resolver, and then uses it to resolve the query.

    See ``dns.asyncresolver.Resolver.resolve`` for more information on the resolution
    parameters, and ``dns.asyncresolver.make_resolver_at`` for information about the
    resolver parameters *where*, *port*, *family*, and *resolver*.

    If making more than one query, it is more efficient to call
    ``dns.asyncresolver.make_resolver_at()`` and then use that resolver for the queries
    instead of calling ``resolve_at()`` multiple times.
    """
    res = await make_resolver_at(where, port, family, resolver)
    return await res.resolve(
        qname,
        rdtype,
        rdclass,
        tcp,
        source,
        raise_on_no_answer,
        source_port,
        lifetime,
        search,
        backend,
    )
