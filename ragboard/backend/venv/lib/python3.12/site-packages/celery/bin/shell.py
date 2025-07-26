"""The ``celery shell`` program, used to start a REPL."""

import os
import sys
from importlib import import_module

import click

from celery.bin.base import CeleryCommand, CeleryOption, handle_preload_options


def _invoke_fallback_shell(locals):
    import code
    try:
        import readline
    except ImportError:
        pass
    else:
        import rlcompleter
        readline.set_completer(
            rlcompleter.Completer(locals).complete)
        readline.parse_and_bind('tab:complete')
    code.interact(local=locals)


def _invoke_bpython_shell(locals):
    import bpython
    bpython.embed(locals)


def _invoke_ipython_shell(locals):
    for ip in (_ipython, _ipython_pre_10,
               _ipython_terminal, _ipython_010,
               _no_ipython):
        try:
            return ip(locals)
        except ImportError:
            pass


def _ipython(locals):
    from IPython import start_ipython
    start_ipython(argv=[], user_ns=locals)


def _ipython_pre_10(locals):  # pragma: no cover
    from IPython.frontend.terminal.ipapp import TerminalIPythonApp
    app = TerminalIPythonApp.instance()
    app.initialize(argv=[])
    app.shell.user_ns.update(locals)
    app.start()


def _ipython_terminal(locals):  # pragma: no cover
    from IPython.terminal import embed
    embed.TerminalInteractiveShell(user_ns=locals).mainloop()


def _ipython_010(locals):  # pragma: no cover
    from IPython.Shell import IPShell
    IPShell(argv=[], user_ns=locals).mainloop()


def _no_ipython(self):  # pragma: no cover
    raise ImportError('no suitable ipython found')


def _invoke_default_shell(locals):
    try:
        import IPython  # noqa
    except ImportError:
        try:
            import bpython  # noqa
        except ImportError:
            _invoke_fallback_shell(locals)
        else:
            _invoke_bpython_shell(locals)
    else:
        _invoke_ipython_shell(locals)


@click.command(cls=CeleryCommand, context_settings={
    'allow_extra_args': True
})
@click.option('-I',
              '--ipython',
              is_flag=True,
              cls=CeleryOption,
              help_group="Shell Options",
              help="Force IPython.")
@click.option('-B',
              '--bpython',
              is_flag=True,
              cls=CeleryOption,
              help_group="Shell Options",
              help="Force bpython.")
@click.option('--python',
              is_flag=True,
              cls=CeleryOption,
              help_group="Shell Options",
              help="Force default Python shell.")
@click.option('-T',
              '--without-tasks',
              is_flag=True,
              cls=CeleryOption,
              help_group="Shell Options",
              help="Don't add tasks to locals.")
@click.option('--eventlet',
              is_flag=True,
              cls=CeleryOption,
              help_group="Shell Options",
              help="Use eventlet.")
@click.option('--gevent',
              is_flag=True,
              cls=CeleryOption,
              help_group="Shell Options",
              help="Use gevent.")
@click.pass_context
@handle_preload_options
def shell(ctx, ipython=False, bpython=False,
          python=False, without_tasks=False, eventlet=False,
          gevent=False, **kwargs):
    """Start shell session with convenient access to celery symbols.

    The following symbols will be added to the main globals:
    - ``celery``:  the current application.
    - ``chord``, ``group``, ``chain``, ``chunks``,
      ``xmap``, ``xstarmap`` ``subtask``, ``Task``
    - all registered tasks.
    """
    sys.path.insert(0, os.getcwd())
    if eventlet:
        import_module('celery.concurrency.eventlet')
    if gevent:
        import_module('celery.concurrency.gevent')
    import celery
    app = ctx.obj.app
    app.loader.import_default_modules()

    # pylint: disable=attribute-defined-outside-init
    locals = {
        'app': app,
        'celery': app,
        'Task': celery.Task,
        'chord': celery.chord,
        'group': celery.group,
        'chain': celery.chain,
        'chunks': celery.chunks,
        'xmap': celery.xmap,
        'xstarmap': celery.xstarmap,
        'subtask': celery.subtask,
        'signature': celery.signature,
    }

    if not without_tasks:
        locals.update({
            task.__name__: task for task in app.tasks.values()
            if not task.name.startswith('celery.')
        })

    if python:
        _invoke_fallback_shell(locals)
    elif bpython:
        try:
            _invoke_bpython_shell(locals)
        except ImportError:
            ctx.obj.echo(f'{ctx.obj.ERROR}: bpython is not installed')
    elif ipython:
        try:
            _invoke_ipython_shell(locals)
        except ImportError as e:
            ctx.obj.echo(f'{ctx.obj.ERROR}: {e}')
    _invoke_default_shell(locals)
