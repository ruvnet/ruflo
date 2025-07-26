import asyncio
import sys
from functools import partial

import typer


def _patch_anyio_open_process():
    """
    Patch anyio.open_process to allow detached processes on Windows and Unix-like systems.

    This is necessary to prevent the MCP client from being interrupted by Ctrl+C when running in the CLI.
    """
    import subprocess

    import anyio

    if getattr(anyio, "_tiny_agents_patched", False):
        return
    anyio._tiny_agents_patched = True

    original_open_process = anyio.open_process

    if sys.platform == "win32":
        # On Windows, we need to set the creation flags to create a new process group

        async def open_process_in_new_group(*args, **kwargs):
            """
            Wrapper for open_process to handle Windows-specific process creation flags.
            """
            # Ensure we pass the creation flags for Windows
            kwargs.setdefault("creationflags", subprocess.CREATE_NEW_PROCESS_GROUP)
            return await original_open_process(*args, **kwargs)

        anyio.open_process = open_process_in_new_group
    else:
        # For Unix-like systems, we can use setsid to create a new session
        async def open_process_in_new_group(*args, **kwargs):
            """
            Wrapper for open_process to handle Unix-like systems with start_new_session=True.
            """
            kwargs.setdefault("start_new_session", True)
            return await original_open_process(*args, **kwargs)

        anyio.open_process = open_process_in_new_group


async def _async_prompt(exit_event: asyncio.Event, prompt: str = "» ") -> str:
    """
    Asynchronous prompt function that reads input from stdin without blocking.

    This function is designed to work in an asynchronous context, allowing the event loop to gracefully stop it (e.g. on Ctrl+C).

    Alternatively, we could use https://github.com/vxgmichel/aioconsole but that would be an additional dependency.
    """
    loop = asyncio.get_event_loop()

    if sys.platform == "win32":
        # Windows: Use run_in_executor to avoid blocking the event loop
        # Degraded solution: this is not ideal as user will have to CTRL+C once more to stop the prompt (and it'll not be graceful)
        return await loop.run_in_executor(None, partial(typer.prompt, prompt, prompt_suffix=" "))
    else:
        # UNIX-like: Use loop.add_reader for non-blocking stdin read
        future = loop.create_future()

        def on_input():
            line = sys.stdin.readline()
            loop.remove_reader(sys.stdin)
            future.set_result(line)

        print(prompt, end=" ", flush=True)
        loop.add_reader(sys.stdin, on_input)  # not supported on Windows

        # Wait for user input or exit event
        # Wait until either the user hits enter or exit_event is set
        exit_task = asyncio.create_task(exit_event.wait())
        await asyncio.wait(
            [future, exit_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        # Check which one has been triggered
        if exit_event.is_set():
            future.cancel()
            return ""

        line = await future
        return line.strip()
