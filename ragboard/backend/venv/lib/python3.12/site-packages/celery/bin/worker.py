"""Program used to start a Celery worker instance."""

import os
import sys

import click
from click import ParamType
from click.types import StringParamType

from celery import concurrency
from celery.bin.base import (COMMA_SEPARATED_LIST, LOG_LEVEL, CeleryDaemonCommand, CeleryOption,
                             handle_preload_options)
from celery.concurrency.base import BasePool
from celery.exceptions import SecurityError
from celery.platforms import EX_FAILURE, EX_OK, detached, maybe_drop_privileges
from celery.utils.log import get_logger
from celery.utils.nodenames import default_nodename, host_format, node_format

logger = get_logger(__name__)


class CeleryBeat(ParamType):
    """Celery Beat flag."""

    name = "beat"

    def convert(self, value, param, ctx):
        if ctx.obj.app.IS_WINDOWS and value:
            self.fail('-B option does not work on Windows.  '
                      'Please run celery beat as a separate service.')

        return value


class WorkersPool(click.Choice):
    """Workers pool option."""

    name = "pool"

    def __init__(self):
        """Initialize the workers pool option with the relevant choices."""
        super().__init__(concurrency.get_available_pool_names())

    def convert(self, value, param, ctx):
        # Pools like eventlet/gevent needs to patch libs as early
        # as possible.
        if isinstance(value, type) and issubclass(value, BasePool):
            return value

        value = super().convert(value, param, ctx)
        worker_pool = ctx.obj.app.conf.worker_pool
        if value == 'prefork' and worker_pool:
            # If we got the default pool through the CLI
            # we need to check if the worker pool was configured.
            # If the worker pool was configured, we shouldn't use the default.
            value = concurrency.get_implementation(worker_pool)
        else:
            value = concurrency.get_implementation(value)

            if not value:
                value = concurrency.get_implementation(worker_pool)

        return value


class Hostname(StringParamType):
    """Hostname option."""

    name = "hostname"

    def convert(self, value, param, ctx):
        return host_format(default_nodename(value))


class Autoscale(ParamType):
    """Autoscaling parameter."""

    name = "<min workers>, <max workers>"

    def convert(self, value, param, ctx):
        value = value.split(',')

        if len(value) > 2:
            self.fail("Expected two comma separated integers or one integer."
                      f"Got {len(value)} instead.")

        if len(value) == 1:
            try:
                value = (int(value[0]), 0)
            except ValueError:
                self.fail(f"Expected an integer. Got {value} instead.")

        try:
            return tuple(reversed(sorted(map(int, value))))
        except ValueError:
            self.fail("Expected two comma separated integers."
                      f"Got {value.join(',')} instead.")


CELERY_BEAT = CeleryBeat()
WORKERS_POOL = WorkersPool()
HOSTNAME = Hostname()
AUTOSCALE = Autoscale()

C_FAKEFORK = os.environ.get('C_FAKEFORK')


def detach(path, argv, logfile=None, pidfile=None, uid=None,
           gid=None, umask=None, workdir=None, fake=False, app=None,
           executable=None, hostname=None):
    """Detach program by argv."""
    fake = 1 if C_FAKEFORK else fake
    # `detached()` will attempt to touch the logfile to confirm that error
    # messages won't be lost after detaching stdout/err, but this means we need
    # to pre-format it rather than relying on `setup_logging_subsystem()` like
    # we can elsewhere.
    logfile = node_format(logfile, hostname)
    with detached(logfile, pidfile, uid, gid, umask, workdir, fake,
                  after_forkers=False):
        try:
            if executable is not None:
                path = executable
            os.execv(path, [path] + argv)
            return EX_OK
        except Exception:  # pylint: disable=broad-except
            if app is None:
                from celery import current_app
                app = current_app
            app.log.setup_logging_subsystem(
                'ERROR', logfile, hostname=hostname)
            logger.critical("Can't exec %r", ' '.join([path] + argv),
                            exc_info=True)
            return EX_FAILURE


@click.command(cls=CeleryDaemonCommand,
               context_settings={'allow_extra_args': True})
@click.option('-n',
              '--hostname',
              default=host_format(default_nodename(None)),
              cls=CeleryOption,
              type=HOSTNAME,
              help_group="Worker Options",
              help="Set custom hostname (e.g., 'w1@%%h').  "
                   "Expands: %%h (hostname), %%n (name) and %%d, (domain).")
@click.option('-D',
              '--detach',
              cls=CeleryOption,
              is_flag=True,
              default=False,
              help_group="Worker Options",
              help="Start worker as a background process.")
@click.option('-S',
              '--statedb',
              cls=CeleryOption,
              type=click.Path(),
              callback=lambda ctx, _,
              value: value or ctx.obj.app.conf.worker_state_db,
              help_group="Worker Options",
              help="Path to the state database. The extension '.db' may be "
                   "appended to the filename.")
@click.option('-l',
              '--loglevel',
              default='WARNING',
              cls=CeleryOption,
              type=LOG_LEVEL,
              help_group="Worker Options",
              help="Logging level.")
@click.option('-O',
              '--optimization',
              default='default',
              cls=CeleryOption,
              type=click.Choice(('default', 'fair')),
              help_group="Worker Options",
              help="Apply optimization profile.")
@click.option('--prefetch-multiplier',
              type=int,
              metavar="<prefetch multiplier>",
              callback=lambda ctx, _,
              value: value or ctx.obj.app.conf.worker_prefetch_multiplier,
              cls=CeleryOption,
              help_group="Worker Options",
              help="Set custom prefetch multiplier value "
                   "for this worker instance.")
@click.option('-c',
              '--concurrency',
              type=int,
              metavar="<concurrency>",
              callback=lambda ctx, _,
              value: value or ctx.obj.app.conf.worker_concurrency,
              cls=CeleryOption,
              help_group="Pool Options",
              help="Number of child processes processing the queue.  "
                   "The default is the number of CPUs available"
                   " on your system.")
@click.option('-P',
              '--pool',
              default='prefork',
              type=WORKERS_POOL,
              cls=CeleryOption,
              help_group="Pool Options",
              help="Pool implementation.")
@click.option('-E',
              '--task-events',
              '--events',
              is_flag=True,
              default=None,
              cls=CeleryOption,
              help_group="Pool Options",
              help="Send task-related events that can be captured by monitors"
                   " like celery events, celerymon, and others.")
@click.option('--time-limit',
              type=float,
              cls=CeleryOption,
              help_group="Pool Options",
              help="Enables a hard time limit "
                   "(in seconds int/float) for tasks.")
@click.option('--soft-time-limit',
              type=float,
              cls=CeleryOption,
              help_group="Pool Options",
              help="Enables a soft time limit "
                   "(in seconds int/float) for tasks.")
@click.option('--max-tasks-per-child',
              type=int,
              cls=CeleryOption,
              help_group="Pool Options",
              help="Maximum number of tasks a pool worker can execute before "
                   "it's terminated and replaced by a new worker.")
@click.option('--max-memory-per-child',
              type=int,
              cls=CeleryOption,
              help_group="Pool Options",
              help="Maximum amount of resident memory, in KiB, that may be "
                   "consumed by a child process before it will be replaced "
                   "by a new one.  If a single task causes a child process "
                   "to exceed this limit, the task will be completed and "
                   "the child process will be replaced afterwards.\n"
                   "Default: no limit.")
@click.option('--purge',
              '--discard',
              is_flag=True,
              cls=CeleryOption,
              help_group="Queue Options")
@click.option('--queues',
              '-Q',
              type=COMMA_SEPARATED_LIST,
              cls=CeleryOption,
              help_group="Queue Options")
@click.option('--exclude-queues',
              '-X',
              type=COMMA_SEPARATED_LIST,
              cls=CeleryOption,
              help_group="Queue Options")
@click.option('--include',
              '-I',
              type=COMMA_SEPARATED_LIST,
              cls=CeleryOption,
              help_group="Queue Options")
@click.option('--without-gossip',
              is_flag=True,
              cls=CeleryOption,
              help_group="Features")
@click.option('--without-mingle',
              is_flag=True,
              cls=CeleryOption,
              help_group="Features")
@click.option('--without-heartbeat',
              is_flag=True,
              cls=CeleryOption,
              help_group="Features", )
@click.option('--heartbeat-interval',
              type=int,
              cls=CeleryOption,
              help_group="Features", )
@click.option('--autoscale',
              type=AUTOSCALE,
              cls=CeleryOption,
              help_group="Features", )
@click.option('-B',
              '--beat',
              type=CELERY_BEAT,
              cls=CeleryOption,
              is_flag=True,
              help_group="Embedded Beat Options")
@click.option('-s',
              '--schedule-filename',
              '--schedule',
              callback=lambda ctx, _,
              value: value or ctx.obj.app.conf.beat_schedule_filename,
              cls=CeleryOption,
              help_group="Embedded Beat Options")
@click.option('--scheduler',
              cls=CeleryOption,
              help_group="Embedded Beat Options")
@click.pass_context
@handle_preload_options
def worker(ctx, hostname=None, pool_cls=None, app=None, uid=None, gid=None,
           loglevel=None, logfile=None, pidfile=None, statedb=None,
           **kwargs):
    """Start worker instance.

    \b
    Examples
    --------

    \b
    $ celery --app=proj worker -l INFO
    $ celery -A proj worker -l INFO -Q hipri,lopri
    $ celery -A proj worker --concurrency=4
    $ celery -A proj worker --concurrency=1000 -P eventlet
    $ celery worker --autoscale=10,0

    """
    try:
        app = ctx.obj.app
        if ctx.args:
            try:
                app.config_from_cmdline(ctx.args, namespace='worker')
            except (KeyError, ValueError) as e:
                # TODO: Improve the error messages
                raise click.UsageError(
                    "Unable to parse extra configuration from command line.\n"
                    f"Reason: {e}", ctx=ctx)
        if kwargs.get('detach', False):
            argv = ['-m', 'celery'] + sys.argv[1:]
            if '--detach' in argv:
                argv.remove('--detach')
            if '-D' in argv:
                argv.remove('-D')
            if "--uid" in argv:
                argv.remove('--uid')
            if "--gid" in argv:
                argv.remove('--gid')

            return detach(sys.executable,
                          argv,
                          logfile=logfile,
                          pidfile=pidfile,
                          uid=uid, gid=gid,
                          umask=kwargs.get('umask', None),
                          workdir=kwargs.get('workdir', None),
                          app=app,
                          executable=kwargs.get('executable', None),
                          hostname=hostname)

        maybe_drop_privileges(uid=uid, gid=gid)
        worker = app.Worker(
            hostname=hostname, pool_cls=pool_cls, loglevel=loglevel,
            logfile=logfile,  # node format handled by celery.app.log.setup
            pidfile=node_format(pidfile, hostname),
            statedb=node_format(statedb, hostname),
            no_color=ctx.obj.no_color,
            quiet=ctx.obj.quiet,
            **kwargs)
        worker.start()
        ctx.exit(worker.exitcode)
    except SecurityError as e:
        ctx.obj.error(e.args[0])
        ctx.exit(1)
