# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

from typing import List, Tuple

import dns._features
import dns.asyncbackend

if dns._features.have("doq"):
    import aioquic.quic.configuration  # type: ignore

    from dns._asyncbackend import NullContext
    from dns.quic._asyncio import (
        AsyncioQuicConnection,
        AsyncioQuicManager,
        AsyncioQuicStream,
    )
    from dns.quic._common import AsyncQuicConnection, AsyncQuicManager
    from dns.quic._sync import SyncQuicConnection, SyncQuicManager, SyncQuicStream

    have_quic = True

    def null_factory(
        *args,  # pylint: disable=unused-argument
        **kwargs,  # pylint: disable=unused-argument
    ):
        return NullContext(None)

    def _asyncio_manager_factory(
        context, *args, **kwargs  # pylint: disable=unused-argument
    ):
        return AsyncioQuicManager(*args, **kwargs)

    # We have a context factory and a manager factory as for trio we need to have
    # a nursery.

    _async_factories = {"asyncio": (null_factory, _asyncio_manager_factory)}

    if dns._features.have("trio"):
        import trio

        from dns.quic._trio import (  # pylint: disable=ungrouped-imports
            TrioQuicConnection,
            TrioQuicManager,
            TrioQuicStream,
        )

        def _trio_context_factory():
            return trio.open_nursery()

        def _trio_manager_factory(context, *args, **kwargs):
            return TrioQuicManager(context, *args, **kwargs)

        _async_factories["trio"] = (_trio_context_factory, _trio_manager_factory)

    def factories_for_backend(backend=None):
        if backend is None:
            backend = dns.asyncbackend.get_default_backend()
        return _async_factories[backend.name()]

else:  # pragma: no cover
    have_quic = False

    from typing import Any

    class AsyncQuicStream:  # type: ignore
        pass

    class AsyncQuicConnection:  # type: ignore
        async def make_stream(self) -> Any:
            raise NotImplementedError

    class SyncQuicStream:  # type: ignore
        pass

    class SyncQuicConnection:  # type: ignore
        def make_stream(self) -> Any:
            raise NotImplementedError


Headers = List[Tuple[bytes, bytes]]
