"""Worker command-line program.

This module is the 'program-version' of :mod:`celery.worker`.

It does everything necessary to run that module
as an actual application, like installing signal handlers,
platform tweaks, and so on.
"""
import logging
import os
import platform as _platform
import sys
from datetime import datetime
from functools import partial

from billiard.common import REMAP_SIGTERM
from billiard.process import current_process
from kombu.utils.encoding import safe_str

from celery import VERSION_BANNER, platforms, signals
from celery.app import trace
from celery.loaders.app import AppLoader
from celery.platforms import EX_FAILURE, EX_OK, check_privileges
from celery.utils import static, term
from celery.utils.debug import cry
from celery.utils.imports import qualname
from celery.utils.log import get_logger, in_sighandler, set_in_sighandler
from celery.utils.text import pluralize
from celery.worker import WorkController

__all__ = ('Worker',)

logger = get_logger(__name__)
is_jython = sys.platform.startswith('java')
is_pypy = hasattr(sys, 'pypy_version_info')

ARTLINES = [
    ' --------------',
    '--- ***** -----',
    '-- ******* ----',
    '- *** --- * ---',
    '- ** ----------',
    '- ** ----------',
    '- ** ----------',
    '- ** ----------',
    '- *** --- * ---',
    '-- ******* ----',
    '--- ***** -----',
    ' --------------',
]

BANNER = """\
{hostname} v{version}

{platform} {timestamp}

[config]
.> app:         {app}
.> transport:   {conninfo}
.> results:     {results}
.> concurrency: {concurrency}
.> task events: {events}

[queues]
{queues}
"""

EXTRA_INFO_FMT = """
[tasks]
{tasks}
"""


def active_thread_count():
    from threading import enumerate
    return sum(1 for t in enumerate()
               if not t.name.startswith('Dummy-'))


def safe_say(msg):
    print(f'\n{msg}', file=sys.__stderr__, flush=True)


class Worker(WorkController):
    """Worker as a program."""

    def on_before_init(self, quiet=False, **kwargs):
        self.quiet = quiet
        trace.setup_worker_optimizations(self.app, self.hostname)

        # this signal can be used to set up configuration for
        # workers by name.
        signals.celeryd_init.send(
            sender=self.hostname, instance=self,
            conf=self.app.conf, options=kwargs,
        )
        check_privileges(self.app.conf.accept_content)

    def on_after_init(self, purge=False, no_color=None,
                      redirect_stdouts=None, redirect_stdouts_level=None,
                      **kwargs):
        self.redirect_stdouts = self.app.either(
            'worker_redirect_stdouts', redirect_stdouts)
        self.redirect_stdouts_level = self.app.either(
            'worker_redirect_stdouts_level', redirect_stdouts_level)
        super().setup_defaults(**kwargs)
        self.purge = purge
        self.no_color = no_color
        self._isatty = sys.stdout.isatty()
        self.colored = self.app.log.colored(
            self.logfile,
            enabled=not no_color if no_color is not None else no_color
        )

    def on_init_blueprint(self):
        self._custom_logging = self.setup_logging()
        # apply task execution optimizations
        # -- This will finalize the app!
        trace.setup_worker_optimizations(self.app, self.hostname)

    def on_start(self):
        app = self.app
        super().on_start()

        # this signal can be used to, for example, change queues after
        # the -Q option has been applied.
        signals.celeryd_after_setup.send(
            sender=self.hostname, instance=self, conf=app.conf,
        )

        if self.purge:
            self.purge_messages()

        if not self.quiet:
            self.emit_banner()

        self.set_process_status('-active-')
        self.install_platform_tweaks(self)
        if not self._custom_logging and self.redirect_stdouts:
            app.log.redirect_stdouts(self.redirect_stdouts_level)

        # TODO: Remove the following code in Celery 6.0
        # This qualifies as a hack for issue #6366.
        warn_deprecated = True
        config_source = app._config_source
        if isinstance(config_source, str):
            # Don't raise the warning when the settings originate from
            # django.conf:settings
            warn_deprecated = config_source.lower() not in [
                'django.conf:settings',
            ]

        if warn_deprecated:
            if app.conf.maybe_warn_deprecated_settings():
                logger.warning(
                    "Please run `celery upgrade settings path/to/settings.py` "
                    "to avoid these warnings and to allow a smoother upgrade "
                    "to Celery 6.0."
                )

    def emit_banner(self):
        # Dump configuration to screen so we have some basic information
        # for when users sends bug reports.
        use_image = term.supports_images()
        if use_image:
            print(term.imgcat(static.logo()))
        print(safe_str(''.join([
            str(self.colored.cyan(
                ' \n', self.startup_info(artlines=not use_image))),
            str(self.colored.reset(self.extra_info() or '')),
        ])), file=sys.__stdout__, flush=True)

    def on_consumer_ready(self, consumer):
        signals.worker_ready.send(sender=consumer)
        logger.info('%s ready.', safe_str(self.hostname))

    def setup_logging(self, colorize=None):
        if colorize is None and self.no_color is not None:
            colorize = not self.no_color
        return self.app.log.setup(
            self.loglevel, self.logfile,
            redirect_stdouts=False, colorize=colorize, hostname=self.hostname,
        )

    def purge_messages(self):
        with self.app.connection_for_write() as connection:
            count = self.app.control.purge(connection=connection)
            if count:  # pragma: no cover
                print(f"purge: Erased {count} {pluralize(count, 'message')} from the queue.\n", flush=True)

    def tasklist(self, include_builtins=True, sep='\n', int_='celery.'):
        return sep.join(
            f'  . {task}' for task in sorted(self.app.tasks)
            if (not task.startswith(int_) if not include_builtins else task)
        )

    def extra_info(self):
        if self.loglevel is None:
            return
        if self.loglevel <= logging.INFO:
            include_builtins = self.loglevel <= logging.DEBUG
            tasklist = self.tasklist(include_builtins=include_builtins)
            return EXTRA_INFO_FMT.format(tasks=tasklist)

    def startup_info(self, artlines=True):
        app = self.app
        concurrency = str(self.concurrency)
        appr = '{}:{:#x}'.format(app.main or '__main__', id(app))
        if not isinstance(app.loader, AppLoader):
            loader = qualname(app.loader)
            if loader.startswith('celery.loaders'):  # pragma: no cover
                loader = loader[14:]
            appr += f' ({loader})'
        if self.autoscale:
            max, min = self.autoscale
            concurrency = f'{{min={min}, max={max}}}'
        pool = self.pool_cls
        if not isinstance(pool, str):
            pool = pool.__module__
        concurrency += f" ({pool.split('.')[-1]})"
        events = 'ON'
        if not self.task_events:
            events = 'OFF (enable -E to monitor tasks in this worker)'

        banner = BANNER.format(
            app=appr,
            hostname=safe_str(self.hostname),
            timestamp=datetime.now().replace(microsecond=0),
            version=VERSION_BANNER,
            conninfo=self.app.connection().as_uri(),
            results=self.app.backend.as_uri(),
            concurrency=concurrency,
            platform=safe_str(_platform.platform()),
            events=events,
            queues=app.amqp.queues.format(indent=0, indent_first=False),
        ).splitlines()

        # integrate the ASCII art.
        if artlines:
            for i, _ in enumerate(banner):
                try:
                    banner[i] = ' '.join([ARTLINES[i], banner[i]])
                except IndexError:
                    banner[i] = ' ' * 16 + banner[i]
        return '\n'.join(banner) + '\n'

    def install_platform_tweaks(self, worker):
        """Install platform specific tweaks and workarounds."""
        if self.app.IS_macOS:
            self.macOS_proxy_detection_workaround()

        # Install signal handler so SIGHUP restarts the worker.
        if not self._isatty:
            # only install HUP handler if detached from terminal,
            # so closing the terminal window doesn't restart the worker
            # into the background.
            if self.app.IS_macOS:
                # macOS can't exec from a process using threads.
                # See https://github.com/celery/celery/issues#issue/152
                install_HUP_not_supported_handler(worker)
            else:
                install_worker_restart_handler(worker)
        install_worker_term_handler(worker)
        install_worker_term_hard_handler(worker)
        install_worker_int_handler(worker)
        install_cry_handler()
        install_rdb_handler()

    def macOS_proxy_detection_workaround(self):
        """See https://github.com/celery/celery/issues#issue/161."""
        os.environ.setdefault('celery_dummy_proxy', 'set_by_celeryd')

    def set_process_status(self, info):
        return platforms.set_mp_process_title(
            'celeryd',
            info=f'{info} ({platforms.strargv(sys.argv)})',
            hostname=self.hostname,
        )


def _shutdown_handler(worker, sig='TERM', how='Warm',
                      callback=None, exitcode=EX_OK):
    def _handle_request(*args):
        with in_sighandler():
            from celery.worker import state
            if current_process()._name == 'MainProcess':
                if callback:
                    callback(worker)
                safe_say(f'worker: {how} shutdown (MainProcess)')
                signals.worker_shutting_down.send(
                    sender=worker.hostname, sig=sig, how=how,
                    exitcode=exitcode,
                )
            setattr(state, {'Warm': 'should_stop',
                            'Cold': 'should_terminate'}[how], exitcode)
    _handle_request.__name__ = str(f'worker_{how}')
    platforms.signals[sig] = _handle_request


if REMAP_SIGTERM == "SIGQUIT":
    install_worker_term_handler = partial(
        _shutdown_handler, sig='SIGTERM', how='Cold', exitcode=EX_FAILURE,
    )
else:
    install_worker_term_handler = partial(
        _shutdown_handler, sig='SIGTERM', how='Warm',
    )

if not is_jython:  # pragma: no cover
    install_worker_term_hard_handler = partial(
        _shutdown_handler, sig='SIGQUIT', how='Cold',
        exitcode=EX_FAILURE,
    )
else:  # pragma: no cover
    install_worker_term_handler = \
        install_worker_term_hard_handler = lambda *a, **kw: None


def on_SIGINT(worker):
    safe_say('worker: Hitting Ctrl+C again will terminate all running tasks!')
    install_worker_term_hard_handler(worker, sig='SIGINT')


if not is_jython:  # pragma: no cover
    install_worker_int_handler = partial(
        _shutdown_handler, sig='SIGINT', callback=on_SIGINT,
        exitcode=EX_FAILURE,
    )
else:  # pragma: no cover
    def install_worker_int_handler(*args, **kwargs):
        pass


def _reload_current_worker():
    platforms.close_open_fds([
        sys.__stdin__, sys.__stdout__, sys.__stderr__,
    ])
    os.execv(sys.executable, [sys.executable] + sys.argv)


def install_worker_restart_handler(worker, sig='SIGHUP'):

    def restart_worker_sig_handler(*args):
        """Signal handler restarting the current python program."""
        set_in_sighandler(True)
        safe_say(f"Restarting celery worker ({' '.join(sys.argv)})")
        import atexit
        atexit.register(_reload_current_worker)
        from celery.worker import state
        state.should_stop = EX_OK
    platforms.signals[sig] = restart_worker_sig_handler


def install_cry_handler(sig='SIGUSR1'):
    # PyPy does not have sys._current_frames
    if is_pypy:  # pragma: no cover
        return

    def cry_handler(*args):
        """Signal handler logging the stack-trace of all active threads."""
        with in_sighandler():
            safe_say(cry())
    platforms.signals[sig] = cry_handler


def install_rdb_handler(envvar='CELERY_RDBSIG',
                        sig='SIGUSR2'):  # pragma: no cover

    def rdb_handler(*args):
        """Signal handler setting a rdb breakpoint at the current frame."""
        with in_sighandler():
            from celery.contrib.rdb import _frame, set_trace

            # gevent does not pass standard signal handler args
            frame = args[1] if args else _frame().f_back
            set_trace(frame)
    if os.environ.get(envvar):
        platforms.signals[sig] = rdb_handler


def install_HUP_not_supported_handler(worker, sig='SIGHUP'):

    def warn_on_HUP_handler(signum, frame):
        with in_sighandler():
            safe_say('{sig} not supported: Restarting with {sig} is '
                     'unstable on this platform!'.format(sig=sig))
    platforms.signals[sig] = warn_on_HUP_handler
