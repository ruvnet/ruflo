"""The ``celery events`` program."""
import sys
from functools import partial

import click

from celery.bin.base import LOG_LEVEL, CeleryDaemonCommand, CeleryOption, handle_preload_options
from celery.platforms import detached, set_process_title, strargv


def _set_process_status(prog, info=''):
    prog = '{}:{}'.format('celery events', prog)
    info = f'{info} {strargv(sys.argv)}'
    return set_process_title(prog, info=info)


def _run_evdump(app):
    from celery.events.dumper import evdump
    _set_process_status('dump')
    return evdump(app=app)


def _run_evcam(camera, app, logfile=None, pidfile=None, uid=None,
               gid=None, umask=None, workdir=None,
               detach=False, **kwargs):
    from celery.events.snapshot import evcam
    _set_process_status('cam')
    kwargs['app'] = app
    cam = partial(evcam, camera,
                  logfile=logfile, pidfile=pidfile, **kwargs)

    if detach:
        with detached(logfile, pidfile, uid, gid, umask, workdir):
            return cam()
    else:
        return cam()


def _run_evtop(app):
    try:
        from celery.events.cursesmon import evtop
        _set_process_status('top')
        return evtop(app=app)
    except ModuleNotFoundError as e:
        if e.name == '_curses':
            # TODO: Improve this error message
            raise click.UsageError("The curses module is required for this command.")


@click.command(cls=CeleryDaemonCommand)
@click.option('-d',
              '--dump',
              cls=CeleryOption,
              is_flag=True,
              help_group='Dumper')
@click.option('-c',
              '--camera',
              cls=CeleryOption,
              help_group='Snapshot')
@click.option('-d',
              '--detach',
              cls=CeleryOption,
              is_flag=True,
              help_group='Snapshot')
@click.option('-F', '--frequency', '--freq',
              type=float,
              default=1.0,
              cls=CeleryOption,
              help_group='Snapshot')
@click.option('-r', '--maxrate',
              cls=CeleryOption,
              help_group='Snapshot')
@click.option('-l',
              '--loglevel',
              default='WARNING',
              cls=CeleryOption,
              type=LOG_LEVEL,
              help_group="Snapshot",
              help="Logging level.")
@click.pass_context
@handle_preload_options
def events(ctx, dump, camera, detach, frequency, maxrate, loglevel, **kwargs):
    """Event-stream utilities."""
    app = ctx.obj.app
    if dump:
        return _run_evdump(app)

    if camera:
        return _run_evcam(camera, app=app, freq=frequency, maxrate=maxrate,
                          loglevel=loglevel,
                          detach=detach,
                          **kwargs)

    return _run_evtop(app)
