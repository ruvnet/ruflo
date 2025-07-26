"""Celery Command Line Interface."""
import os
import pathlib
import sys
import traceback

try:
    from importlib.metadata import entry_points
except ImportError:
    from importlib_metadata import entry_points

import click
import click.exceptions
from click.types import ParamType
from click_didyoumean import DYMGroup
from click_plugins import with_plugins

from celery import VERSION_BANNER
from celery.app.utils import find_app
from celery.bin.amqp import amqp
from celery.bin.base import CeleryCommand, CeleryOption, CLIContext
from celery.bin.beat import beat
from celery.bin.call import call
from celery.bin.control import control, inspect, status
from celery.bin.events import events
from celery.bin.graph import graph
from celery.bin.list import list_
from celery.bin.logtool import logtool
from celery.bin.migrate import migrate
from celery.bin.multi import multi
from celery.bin.purge import purge
from celery.bin.result import result
from celery.bin.shell import shell
from celery.bin.upgrade import upgrade
from celery.bin.worker import worker

UNABLE_TO_LOAD_APP_MODULE_NOT_FOUND = click.style("""
Unable to load celery application.
The module {0} was not found.""", fg='red')

UNABLE_TO_LOAD_APP_ERROR_OCCURRED = click.style("""
Unable to load celery application.
While trying to load the module {0} the following error occurred:
{1}""", fg='red')

UNABLE_TO_LOAD_APP_APP_MISSING = click.style("""
Unable to load celery application.
{0}""")


class App(ParamType):
    """Application option."""

    name = "application"

    def convert(self, value, param, ctx):
        try:
            return find_app(value)
        except ModuleNotFoundError as e:
            if e.name != value:
                exc = traceback.format_exc()
                self.fail(
                    UNABLE_TO_LOAD_APP_ERROR_OCCURRED.format(value, exc)
                )
            self.fail(UNABLE_TO_LOAD_APP_MODULE_NOT_FOUND.format(e.name))
        except AttributeError as e:
            attribute_name = e.args[0].capitalize()
            self.fail(UNABLE_TO_LOAD_APP_APP_MISSING.format(attribute_name))
        except Exception:
            exc = traceback.format_exc()
            self.fail(
                UNABLE_TO_LOAD_APP_ERROR_OCCURRED.format(value, exc)
            )


APP = App()


if sys.version_info >= (3, 10):
    _PLUGINS = entry_points(group='celery.commands')
else:
    try:
        _PLUGINS = entry_points().get('celery.commands', [])
    except AttributeError:
        _PLUGINS = entry_points().select(group='celery.commands')


@with_plugins(_PLUGINS)
@click.group(cls=DYMGroup, invoke_without_command=True)
@click.option('-A',
              '--app',
              envvar='APP',
              cls=CeleryOption,
              type=APP,
              help_group="Global Options")
@click.option('-b',
              '--broker',
              envvar='BROKER_URL',
              cls=CeleryOption,
              help_group="Global Options")
@click.option('--result-backend',
              envvar='RESULT_BACKEND',
              cls=CeleryOption,
              help_group="Global Options")
@click.option('--loader',
              envvar='LOADER',
              cls=CeleryOption,
              help_group="Global Options")
@click.option('--config',
              envvar='CONFIG_MODULE',
              cls=CeleryOption,
              help_group="Global Options")
@click.option('--workdir',
              cls=CeleryOption,
              type=pathlib.Path,
              callback=lambda _, __, wd: os.chdir(wd) if wd else None,
              is_eager=True,
              help_group="Global Options")
@click.option('-C',
              '--no-color',
              envvar='NO_COLOR',
              is_flag=True,
              cls=CeleryOption,
              help_group="Global Options")
@click.option('-q',
              '--quiet',
              is_flag=True,
              cls=CeleryOption,
              help_group="Global Options")
@click.option('--version',
              cls=CeleryOption,
              is_flag=True,
              help_group="Global Options")
@click.option('--skip-checks',
              envvar='SKIP_CHECKS',
              cls=CeleryOption,
              is_flag=True,
              help_group="Global Options",
              help="Skip Django core checks on startup. Setting the SKIP_CHECKS environment "
                   "variable to any non-empty string will have the same effect.")
@click.pass_context
def celery(ctx, app, broker, result_backend, loader, config, workdir,
           no_color, quiet, version, skip_checks):
    """Celery command entrypoint."""
    if version:
        click.echo(VERSION_BANNER)
        ctx.exit()
    elif ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())
        ctx.exit()

    if loader:
        # Default app takes loader from this env (Issue #1066).
        os.environ['CELERY_LOADER'] = loader
    if broker:
        os.environ['CELERY_BROKER_URL'] = broker
    if result_backend:
        os.environ['CELERY_RESULT_BACKEND'] = result_backend
    if config:
        os.environ['CELERY_CONFIG_MODULE'] = config
    if skip_checks:
        os.environ['CELERY_SKIP_CHECKS'] = 'true'
    ctx.obj = CLIContext(app=app, no_color=no_color, workdir=workdir,
                         quiet=quiet)

    # User options
    worker.params.extend(ctx.obj.app.user_options.get('worker', []))
    beat.params.extend(ctx.obj.app.user_options.get('beat', []))
    events.params.extend(ctx.obj.app.user_options.get('events', []))

    for command in celery.commands.values():
        command.params.extend(ctx.obj.app.user_options.get('preload', []))


@celery.command(cls=CeleryCommand)
@click.pass_context
def report(ctx, **kwargs):
    """Shows information useful to include in bug-reports."""
    app = ctx.obj.app
    app.loader.import_default_modules()
    ctx.obj.echo(app.bugreport())


celery.add_command(purge)
celery.add_command(call)
celery.add_command(beat)
celery.add_command(list_)
celery.add_command(result)
celery.add_command(migrate)
celery.add_command(status)
celery.add_command(worker)
celery.add_command(events)
celery.add_command(inspect)
celery.add_command(control)
celery.add_command(graph)
celery.add_command(upgrade)
celery.add_command(logtool)
celery.add_command(amqp)
celery.add_command(shell)
celery.add_command(multi)

# Monkey-patch click to display a custom error
# when -A or --app are used as sub-command options instead of as options
# of the global command.

previous_show_implementation = click.exceptions.NoSuchOption.show

WRONG_APP_OPTION_USAGE_MESSAGE = """You are using `{option_name}` as an option of the {info_name} sub-command:
celery {info_name} {option_name} celeryapp <...>

The support for this usage was removed in Celery 5.0. Instead you should use `{option_name}` as a global option:
celery {option_name} celeryapp {info_name} <...>"""


def _show(self, file=None):
    if self.option_name in ('-A', '--app'):
        self.ctx.obj.error(
            WRONG_APP_OPTION_USAGE_MESSAGE.format(
                option_name=self.option_name,
                info_name=self.ctx.info_name),
            fg='red'
        )
    previous_show_implementation(self, file=file)


click.exceptions.NoSuchOption.show = _show


def main() -> int:
    """Start celery umbrella command.

    This function is the main entrypoint for the CLI.

    :return: The exit code of the CLI.
    """
    return celery(auto_envvar_prefix="CELERY")
