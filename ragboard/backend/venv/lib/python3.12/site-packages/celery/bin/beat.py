"""The :program:`celery beat` command."""
from functools import partial

import click

from celery.bin.base import LOG_LEVEL, CeleryDaemonCommand, CeleryOption, handle_preload_options
from celery.platforms import detached, maybe_drop_privileges


@click.command(cls=CeleryDaemonCommand, context_settings={
    'allow_extra_args': True
})
@click.option('--detach',
              cls=CeleryOption,
              is_flag=True,
              default=False,
              help_group="Beat Options",
              help="Detach and run in the background as a daemon.")
@click.option('-s',
              '--schedule',
              cls=CeleryOption,
              callback=lambda ctx, _, value: value or ctx.obj.app.conf.beat_schedule_filename,
              help_group="Beat Options",
              help="Path to the schedule database."
                   "  Defaults to `celerybeat-schedule`."
                   "The extension '.db' may be appended to the filename.")
@click.option('-S',
              '--scheduler',
              cls=CeleryOption,
              callback=lambda ctx, _, value: value or ctx.obj.app.conf.beat_scheduler,
              help_group="Beat Options",
              help="Scheduler class to use.")
@click.option('--max-interval',
              cls=CeleryOption,
              type=int,
              help_group="Beat Options",
              help="Max seconds to sleep between schedule iterations.")
@click.option('-l',
              '--loglevel',
              default='WARNING',
              cls=CeleryOption,
              type=LOG_LEVEL,
              help_group="Beat Options",
              help="Logging level.")
@click.pass_context
@handle_preload_options
def beat(ctx, detach=False, logfile=None, pidfile=None, uid=None,
         gid=None, umask=None, workdir=None, **kwargs):
    """Start the beat periodic task scheduler."""
    app = ctx.obj.app

    if ctx.args:
        try:
            app.config_from_cmdline(ctx.args)
        except (KeyError, ValueError) as e:
            # TODO: Improve the error messages
            raise click.UsageError("Unable to parse extra configuration"
                                   " from command line.\n"
                                   f"Reason: {e}", ctx=ctx)

    if not detach:
        maybe_drop_privileges(uid=uid, gid=gid)

    beat = partial(app.Beat,
                   logfile=logfile, pidfile=pidfile,
                   quiet=ctx.obj.quiet, **kwargs)

    if detach:
        with detached(logfile, pidfile, uid, gid, umask, workdir):
            return beat().run()
    else:
        return beat().run()
