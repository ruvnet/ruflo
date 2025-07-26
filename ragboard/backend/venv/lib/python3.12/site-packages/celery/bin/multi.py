"""Start multiple worker instances from the command-line.

.. program:: celery multi

Examples
========

.. code-block:: console

    $ # Single worker with explicit name and events enabled.
    $ celery multi start Leslie -E

    $ # Pidfiles and logfiles are stored in the current directory
    $ # by default.  Use --pidfile and --logfile argument to change
    $ # this.  The abbreviation %n will be expanded to the current
    $ # node name.
    $ celery multi start Leslie -E --pidfile=/var/run/celery/%n.pid
                                   --logfile=/var/log/celery/%n%I.log


    $ # You need to add the same arguments when you restart,
    $ # as these aren't persisted anywhere.
    $ celery multi restart Leslie -E --pidfile=/var/run/celery/%n.pid
                                     --logfile=/var/log/celery/%n%I.log

    $ # To stop the node, you need to specify the same pidfile.
    $ celery multi stop Leslie --pidfile=/var/run/celery/%n.pid

    $ # 3 workers, with 3 processes each
    $ celery multi start 3 -c 3
    celery worker -n celery1@myhost -c 3
    celery worker -n celery2@myhost -c 3
    celery worker -n celery3@myhost -c 3

    $ # override name prefix when using range
    $ celery multi start 3 --range-prefix=worker -c 3
    celery worker -n worker1@myhost -c 3
    celery worker -n worker2@myhost -c 3
    celery worker -n worker3@myhost -c 3

    $ # start 3 named workers
    $ celery multi start image video data -c 3
    celery worker -n image@myhost -c 3
    celery worker -n video@myhost -c 3
    celery worker -n data@myhost -c 3

    $ # specify custom hostname
    $ celery multi start 2 --hostname=worker.example.com -c 3
    celery worker -n celery1@worker.example.com -c 3
    celery worker -n celery2@worker.example.com -c 3

    $ # specify fully qualified nodenames
    $ celery multi start foo@worker.example.com bar@worker.example.com -c 3

    $ # fully qualified nodenames but using the current hostname
    $ celery multi start foo@%h bar@%h

    $ # Advanced example starting 10 workers in the background:
    $ #   * Three of the workers processes the images and video queue
    $ #   * Two of the workers processes the data queue with loglevel DEBUG
    $ #   * the rest processes the default' queue.
    $ celery multi start 10 -l INFO -Q:1-3 images,video -Q:4,5 data
        -Q default -L:4,5 DEBUG

    $ # You can show the commands necessary to start the workers with
    $ # the 'show' command:
    $ celery multi show 10 -l INFO -Q:1-3 images,video -Q:4,5 data
        -Q default -L:4,5 DEBUG

    $ # Additional options are added to each celery worker's command,
    $ # but you can also modify the options for ranges of, or specific workers

    $ # 3 workers: Two with 3 processes, and one with 10 processes.
    $ celery multi start 3 -c 3 -c:1 10
    celery worker -n celery1@myhost -c 10
    celery worker -n celery2@myhost -c 3
    celery worker -n celery3@myhost -c 3

    $ # can also specify options for named workers
    $ celery multi start image video data -c 3 -c:image 10
    celery worker -n image@myhost -c 10
    celery worker -n video@myhost -c 3
    celery worker -n data@myhost -c 3

    $ # ranges and lists of workers in options is also allowed:
    $ # (-c:1-3 can also be written as -c:1,2,3)
    $ celery multi start 5 -c 3  -c:1-3 10
    celery worker -n celery1@myhost -c 10
    celery worker -n celery2@myhost -c 10
    celery worker -n celery3@myhost -c 10
    celery worker -n celery4@myhost -c 3
    celery worker -n celery5@myhost -c 3

    $ # lists also works with named workers
    $ celery multi start foo bar baz xuzzy -c 3 -c:foo,bar,baz 10
    celery worker -n foo@myhost -c 10
    celery worker -n bar@myhost -c 10
    celery worker -n baz@myhost -c 10
    celery worker -n xuzzy@myhost -c 3
"""
import os
import signal
import sys
from functools import wraps

import click
from kombu.utils.objects import cached_property

from celery import VERSION_BANNER
from celery.apps.multi import Cluster, MultiParser, NamespacedOptionParser
from celery.bin.base import CeleryCommand, handle_preload_options
from celery.platforms import EX_FAILURE, EX_OK, signals
from celery.utils import term
from celery.utils.text import pluralize

__all__ = ('MultiTool',)

USAGE = """\
usage: {prog_name} start <node1 node2 nodeN|range> [worker options]
       {prog_name} stop <n1 n2 nN|range> [-SIG (default: -TERM)]
       {prog_name} restart <n1 n2 nN|range> [-SIG] [worker options]
       {prog_name} kill <n1 n2 nN|range>

       {prog_name} show <n1 n2 nN|range> [worker options]
       {prog_name} get hostname <n1 n2 nN|range> [-qv] [worker options]
       {prog_name} names <n1 n2 nN|range>
       {prog_name} expand template <n1 n2 nN|range>
       {prog_name} help

additional options (must appear after command name):

    * --nosplash:   Don't display program info.
    * --quiet:      Don't show as much output.
    * --verbose:    Show more output.
    * --no-color:   Don't display colors.
"""


def main():
    sys.exit(MultiTool().execute_from_commandline(sys.argv))


def splash(fun):

    @wraps(fun)
    def _inner(self, *args, **kwargs):
        self.splash()
        return fun(self, *args, **kwargs)
    return _inner


def using_cluster(fun):

    @wraps(fun)
    def _inner(self, *argv, **kwargs):
        return fun(self, self.cluster_from_argv(argv), **kwargs)
    return _inner


def using_cluster_and_sig(fun):

    @wraps(fun)
    def _inner(self, *argv, **kwargs):
        p, cluster = self._cluster_from_argv(argv)
        sig = self._find_sig_argument(p)
        return fun(self, cluster, sig, **kwargs)
    return _inner


class TermLogger:

    splash_text = 'celery multi v{version}'
    splash_context = {'version': VERSION_BANNER}

    #: Final exit code.
    retcode = 0

    def setup_terminal(self, stdout, stderr,
                       nosplash=False, quiet=False, verbose=False,
                       no_color=False, **kwargs):
        self.stdout = stdout or sys.stdout
        self.stderr = stderr or sys.stderr
        self.nosplash = nosplash
        self.quiet = quiet
        self.verbose = verbose
        self.no_color = no_color

    def ok(self, m, newline=True, file=None):
        self.say(m, newline=newline, file=file)
        return EX_OK

    def say(self, m, newline=True, file=None):
        print(m, file=file or self.stdout, end='\n' if newline else '')

    def carp(self, m, newline=True, file=None):
        return self.say(m, newline, file or self.stderr)

    def error(self, msg=None):
        if msg:
            self.carp(msg)
        self.usage()
        return EX_FAILURE

    def info(self, msg, newline=True):
        if self.verbose:
            self.note(msg, newline=newline)

    def note(self, msg, newline=True):
        if not self.quiet:
            self.say(str(msg), newline=newline)

    @splash
    def usage(self):
        self.say(USAGE.format(prog_name=self.prog_name))

    def splash(self):
        if not self.nosplash:
            self.note(self.colored.cyan(
                self.splash_text.format(**self.splash_context)))

    @cached_property
    def colored(self):
        return term.colored(enabled=not self.no_color)


class MultiTool(TermLogger):
    """The ``celery multi`` program."""

    MultiParser = MultiParser
    OptionParser = NamespacedOptionParser

    reserved_options = [
        ('--nosplash', 'nosplash'),
        ('--quiet', 'quiet'),
        ('-q', 'quiet'),
        ('--verbose', 'verbose'),
        ('--no-color', 'no_color'),
    ]

    def __init__(self, env=None, cmd=None,
                 fh=None, stdout=None, stderr=None, **kwargs):
        # fh is an old alias to stdout.
        self.env = env
        self.cmd = cmd
        self.setup_terminal(stdout or fh, stderr, **kwargs)
        self.fh = self.stdout
        self.prog_name = 'celery multi'
        self.commands = {
            'start': self.start,
            'show': self.show,
            'stop': self.stop,
            'stopwait': self.stopwait,
            'stop_verify': self.stopwait,  # compat alias
            'restart': self.restart,
            'kill': self.kill,
            'names': self.names,
            'expand': self.expand,
            'get': self.get,
            'help': self.help,
        }

    def execute_from_commandline(self, argv, cmd=None):
        # Reserve the --nosplash|--quiet|-q/--verbose options.
        argv = self._handle_reserved_options(argv)
        self.cmd = cmd if cmd is not None else self.cmd
        self.prog_name = os.path.basename(argv.pop(0))

        if not self.validate_arguments(argv):
            return self.error()

        return self.call_command(argv[0], argv[1:])

    def validate_arguments(self, argv):
        return argv and argv[0][0] != '-'

    def call_command(self, command, argv):
        try:
            return self.commands[command](*argv) or EX_OK
        except KeyError:
            return self.error(f'Invalid command: {command}')

    def _handle_reserved_options(self, argv):
        argv = list(argv)  # don't modify callers argv.
        for arg, attr in self.reserved_options:
            if arg in argv:
                setattr(self, attr, bool(argv.pop(argv.index(arg))))
        return argv

    @splash
    @using_cluster
    def start(self, cluster):
        self.note('> Starting nodes...')
        return int(any(cluster.start()))

    @splash
    @using_cluster_and_sig
    def stop(self, cluster, sig, **kwargs):
        return cluster.stop(sig=sig, **kwargs)

    @splash
    @using_cluster_and_sig
    def stopwait(self, cluster, sig, **kwargs):
        return cluster.stopwait(sig=sig, **kwargs)
    stop_verify = stopwait  # compat

    @splash
    @using_cluster_and_sig
    def restart(self, cluster, sig, **kwargs):
        return int(any(cluster.restart(sig=sig, **kwargs)))

    @using_cluster
    def names(self, cluster):
        self.say('\n'.join(n.name for n in cluster))

    def get(self, wanted, *argv):
        try:
            node = self.cluster_from_argv(argv).find(wanted)
        except KeyError:
            return EX_FAILURE
        else:
            return self.ok(' '.join(node.argv))

    @using_cluster
    def show(self, cluster):
        return self.ok('\n'.join(
            ' '.join(node.argv_with_executable)
            for node in cluster
        ))

    @splash
    @using_cluster
    def kill(self, cluster):
        return cluster.kill()

    def expand(self, template, *argv):
        return self.ok('\n'.join(
            node.expander(template)
            for node in self.cluster_from_argv(argv)
        ))

    def help(self, *argv):
        self.say(__doc__)

    def _find_sig_argument(self, p, default=signal.SIGTERM):
        args = p.args[len(p.values):]
        for arg in reversed(args):
            if len(arg) == 2 and arg[0] == '-':
                try:
                    return int(arg[1])
                except ValueError:
                    pass
            if arg[0] == '-':
                try:
                    return signals.signum(arg[1:])
                except (AttributeError, TypeError):
                    pass
        return default

    def _nodes_from_argv(self, argv, cmd=None):
        cmd = cmd if cmd is not None else self.cmd
        p = self.OptionParser(argv)
        p.parse()
        return p, self.MultiParser(cmd=cmd).parse(p)

    def cluster_from_argv(self, argv, cmd=None):
        _, cluster = self._cluster_from_argv(argv, cmd=cmd)
        return cluster

    def _cluster_from_argv(self, argv, cmd=None):
        p, nodes = self._nodes_from_argv(argv, cmd=cmd)
        return p, self.Cluster(list(nodes), cmd=cmd)

    def Cluster(self, nodes, cmd=None):
        return Cluster(
            nodes,
            cmd=cmd,
            env=self.env,
            on_stopping_preamble=self.on_stopping_preamble,
            on_send_signal=self.on_send_signal,
            on_still_waiting_for=self.on_still_waiting_for,
            on_still_waiting_progress=self.on_still_waiting_progress,
            on_still_waiting_end=self.on_still_waiting_end,
            on_node_start=self.on_node_start,
            on_node_restart=self.on_node_restart,
            on_node_shutdown_ok=self.on_node_shutdown_ok,
            on_node_status=self.on_node_status,
            on_node_signal_dead=self.on_node_signal_dead,
            on_node_signal=self.on_node_signal,
            on_node_down=self.on_node_down,
            on_child_spawn=self.on_child_spawn,
            on_child_signalled=self.on_child_signalled,
            on_child_failure=self.on_child_failure,
        )

    def on_stopping_preamble(self, nodes):
        self.note(self.colored.blue('> Stopping nodes...'))

    def on_send_signal(self, node, sig):
        self.note('\t> {0.name}: {1} -> {0.pid}'.format(node, sig))

    def on_still_waiting_for(self, nodes):
        num_left = len(nodes)
        if num_left:
            self.note(self.colored.blue(
                '> Waiting for {} {} -> {}...'.format(
                    num_left, pluralize(num_left, 'node'),
                    ', '.join(str(node.pid) for node in nodes)),
            ), newline=False)

    def on_still_waiting_progress(self, nodes):
        self.note('.', newline=False)

    def on_still_waiting_end(self):
        self.note('')

    def on_node_signal_dead(self, node):
        self.note(
            'Could not signal {0.name} ({0.pid}): No such process'.format(
                node))

    def on_node_start(self, node):
        self.note(f'\t> {node.name}: ', newline=False)

    def on_node_restart(self, node):
        self.note(self.colored.blue(
            f'> Restarting node {node.name}: '), newline=False)

    def on_node_down(self, node):
        self.note(f'> {node.name}: {self.DOWN}')

    def on_node_shutdown_ok(self, node):
        self.note(f'\n\t> {node.name}: {self.OK}')

    def on_node_status(self, node, retval):
        self.note(retval and self.FAILED or self.OK)

    def on_node_signal(self, node, sig):
        self.note('Sending {sig} to node {0.name} ({0.pid})'.format(
            node, sig=sig))

    def on_child_spawn(self, node, argstr, env):
        self.info(f'  {argstr}')

    def on_child_signalled(self, node, signum):
        self.note(f'* Child was terminated by signal {signum}')

    def on_child_failure(self, node, retcode):
        self.note(f'* Child terminated with exit code {retcode}')

    @cached_property
    def OK(self):
        return str(self.colored.green('OK'))

    @cached_property
    def FAILED(self):
        return str(self.colored.red('FAILED'))

    @cached_property
    def DOWN(self):
        return str(self.colored.magenta('DOWN'))


@click.command(
    cls=CeleryCommand,
    context_settings={
        'allow_extra_args': True,
        'ignore_unknown_options': True
    }
)
@click.pass_context
@handle_preload_options
def multi(ctx, **kwargs):
    """Start multiple worker instances."""
    cmd = MultiTool(quiet=ctx.obj.quiet, no_color=ctx.obj.no_color)
    # In 4.x, celery multi ignores the global --app option.
    # Since in 5.0 the --app option is global only we
    # rearrange the arguments so that the MultiTool will parse them correctly.
    args = sys.argv[1:]
    args = args[args.index('multi'):] + args[:args.index('multi')]
    return cmd.execute_from_commandline(args)
