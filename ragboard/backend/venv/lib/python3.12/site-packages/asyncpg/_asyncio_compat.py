# Backports from Python/Lib/asyncio for older Pythons
#
# Copyright (c) 2001-2023 Python Software Foundation; All Rights Reserved
#
# SPDX-License-Identifier: PSF-2.0


import asyncio
import functools
import sys

if sys.version_info < (3, 11):
    from async_timeout import timeout as timeout_ctx
else:
    from asyncio import timeout as timeout_ctx


async def wait_for(fut, timeout):
    """Wait for the single Future or coroutine to complete, with timeout.

    Coroutine will be wrapped in Task.

    Returns result of the Future or coroutine.  When a timeout occurs,
    it cancels the task and raises TimeoutError.  To avoid the task
    cancellation, wrap it in shield().

    If the wait is cancelled, the task is also cancelled.

    If the task supresses the cancellation and returns a value instead,
    that value is returned.

    This function is a coroutine.
    """
    # The special case for timeout <= 0 is for the following case:
    #
    # async def test_waitfor():
    #     func_started = False
    #
    #     async def func():
    #         nonlocal func_started
    #         func_started = True
    #
    #     try:
    #         await asyncio.wait_for(func(), 0)
    #     except asyncio.TimeoutError:
    #         assert not func_started
    #     else:
    #         assert False
    #
    # asyncio.run(test_waitfor())

    if timeout is not None and timeout <= 0:
        fut = asyncio.ensure_future(fut)

        if fut.done():
            return fut.result()

        await _cancel_and_wait(fut)
        try:
            return fut.result()
        except asyncio.CancelledError as exc:
            raise TimeoutError from exc

    async with timeout_ctx(timeout):
        return await fut


async def _cancel_and_wait(fut):
    """Cancel the *fut* future or task and wait until it completes."""

    loop = asyncio.get_running_loop()
    waiter = loop.create_future()
    cb = functools.partial(_release_waiter, waiter)
    fut.add_done_callback(cb)

    try:
        fut.cancel()
        # We cannot wait on *fut* directly to make
        # sure _cancel_and_wait itself is reliably cancellable.
        await waiter
    finally:
        fut.remove_done_callback(cb)


def _release_waiter(waiter, *args):
    if not waiter.done():
        waiter.set_result(None)
