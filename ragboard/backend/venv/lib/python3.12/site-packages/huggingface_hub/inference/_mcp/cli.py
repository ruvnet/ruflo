import asyncio
import os
import signal
import traceback
from typing import Optional

import typer
from rich import print

from ._cli_hacks import _async_prompt, _patch_anyio_open_process
from .agent import Agent
from .utils import _load_agent_config


app = typer.Typer(
    rich_markup_mode="rich",
    help="A squad of lightweight composable AI applications built on Hugging Face's Inference Client and MCP stack.",
)

run_cli = typer.Typer(
    name="run",
    help="Run the Agent in the CLI",
    invoke_without_command=True,
)
app.add_typer(run_cli, name="run")


async def run_agent(
    agent_path: Optional[str],
) -> None:
    """
    Tiny Agent loop.

    Args:
        agent_path (`str`, *optional*):
            Path to a local folder containing an `agent.json` and optionally a custom `PROMPT.md` file or a built-in agent stored in a Hugging Face dataset.

    """
    _patch_anyio_open_process()  # Hacky way to prevent stdio connections to be stopped by Ctrl+C

    config, prompt = _load_agent_config(agent_path)

    inputs = config.get("inputs", [])
    servers = config.get("servers", [])

    abort_event = asyncio.Event()
    exit_event = asyncio.Event()
    first_sigint = True

    loop = asyncio.get_running_loop()
    original_sigint_handler = signal.getsignal(signal.SIGINT)

    def _sigint_handler() -> None:
        nonlocal first_sigint
        if first_sigint:
            first_sigint = False
            abort_event.set()
            print("\n[red]Interrupted. Press Ctrl+C again to quit.[/red]", flush=True)
            return

        print("\n[red]Exiting...[/red]", flush=True)
        exit_event.set()

    try:
        sigint_registered_in_loop = False
        try:
            loop.add_signal_handler(signal.SIGINT, _sigint_handler)
            sigint_registered_in_loop = True
        except (AttributeError, NotImplementedError):
            # Windows (or any loop that doesn't support it) : fall back to sync
            signal.signal(signal.SIGINT, lambda *_: _sigint_handler())

        # Handle inputs (i.e. env variables injection)
        if len(inputs) > 0:
            print(
                "[bold blue]Some initial inputs are required by the agent. "
                "Please provide a value or leave empty to load from env.[/bold blue]"
            )
            for input_item in inputs:
                input_id = input_item["id"]
                description = input_item["description"]
                env_special_value = "${input:" + input_id + "}"  # Special value to indicate env variable injection

                # Check env variables that will use this input
                input_vars = set()
                for server in servers:
                    # Check stdio's "env" and http/sse's "headers" mappings
                    env_or_headers = server.get("env", {}) if server["type"] == "stdio" else server.get("headers", {})
                    for key, value in env_or_headers.items():
                        if env_special_value in value:
                            input_vars.add(key)

                if not input_vars:
                    print(f"[yellow]Input {input_id} defined in config but not used by any server.[/yellow]")
                    continue

                # Prompt user for input
                env_variable_key = input_id.replace("-", "_").upper()
                print(
                    f"[blue] • {input_id}[/blue]: {description}. (default: load from {env_variable_key}).",
                    end=" ",
                )
                user_input = (await _async_prompt(exit_event=exit_event)).strip()
                if exit_event.is_set():
                    return

                # Inject user input (or env variable) into stdio's env or http/sse's headers
                for server in servers:
                    env_or_headers = server.get("env", {}) if server["type"] == "stdio" else server.get("headers", {})
                    for key, value in env_or_headers.items():
                        if env_special_value in value:
                            if user_input:
                                env_or_headers[key] = env_or_headers[key].replace(env_special_value, user_input)
                            else:
                                value_from_env = os.getenv(env_variable_key, "")
                                env_or_headers[key] = env_or_headers[key].replace(env_special_value, value_from_env)
                                if value_from_env:
                                    print(f"[green]Value successfully loaded from '{env_variable_key}'[/green]")
                                else:
                                    print(
                                        f"[yellow]No value found for '{env_variable_key}' in environment variables. Continuing.[/yellow]"
                                    )

            print()

        # Main agent loop
        async with Agent(
            provider=config.get("provider"),  # type: ignore[arg-type]
            model=config.get("model"),
            base_url=config.get("endpointUrl"),  # type: ignore[arg-type]
            servers=servers,  # type: ignore[arg-type]
            prompt=prompt,
        ) as agent:
            await agent.load_tools()
            print(f"[bold blue]Agent loaded with {len(agent.available_tools)} tools:[/bold blue]")
            for t in agent.available_tools:
                print(f"[blue] • {t.function.name}[/blue]")

            while True:
                abort_event.clear()

                # Check if we should exit
                if exit_event.is_set():
                    return

                try:
                    user_input = await _async_prompt(exit_event=exit_event)
                    first_sigint = True
                except EOFError:
                    print("\n[red]EOF received, exiting.[/red]", flush=True)
                    break
                except KeyboardInterrupt:
                    if not first_sigint and abort_event.is_set():
                        continue
                    else:
                        print("\n[red]Keyboard interrupt during input processing.[/red]", flush=True)
                        break

                try:
                    async for chunk in agent.run(user_input, abort_event=abort_event):
                        if abort_event.is_set() and not first_sigint:
                            break
                        if exit_event.is_set():
                            return

                        if hasattr(chunk, "choices"):
                            delta = chunk.choices[0].delta
                            if delta.content:
                                print(delta.content, end="", flush=True)
                            if delta.tool_calls:
                                for call in delta.tool_calls:
                                    if call.id:
                                        print(f"<Tool {call.id}>", end="")
                                    if call.function.name:
                                        print(f"{call.function.name}", end=" ")
                                    if call.function.arguments:
                                        print(f"{call.function.arguments}", end="")
                        else:
                            print(
                                f"\n\n[green]Tool[{chunk.name}] {chunk.tool_call_id}\n{chunk.content}[/green]\n",
                                flush=True,
                            )

                    print()

                except Exception as e:
                    tb_str = traceback.format_exc()
                    print(f"\n[bold red]Error during agent run: {e}\n{tb_str}[/bold red]", flush=True)
                    first_sigint = True  # Allow graceful interrupt for the next command

    except Exception as e:
        tb_str = traceback.format_exc()
        print(f"\n[bold red]An unexpected error occurred: {e}\n{tb_str}[/bold red]", flush=True)
        raise e

    finally:
        if sigint_registered_in_loop:
            try:
                loop.remove_signal_handler(signal.SIGINT)
            except (AttributeError, NotImplementedError):
                pass
        else:
            signal.signal(signal.SIGINT, original_sigint_handler)


@run_cli.callback()
def run(
    path: Optional[str] = typer.Argument(
        None,
        help=(
            "Path to a local folder containing an agent.json file or a built-in agent "
            "stored in the 'tiny-agents/tiny-agents' Hugging Face dataset "
            "(https://huggingface.co/datasets/tiny-agents/tiny-agents)"
        ),
        show_default=False,
    ),
):
    try:
        asyncio.run(run_agent(path))
    except KeyboardInterrupt:
        print("\n[red]Application terminated by KeyboardInterrupt.[/red]", flush=True)
        raise typer.Exit(code=130)
    except Exception as e:
        print(f"\n[bold red]An unexpected error occurred: {e}[/bold red]", flush=True)
        raise e


if __name__ == "__main__":
    app()
