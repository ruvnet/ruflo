"""The ``celery logtool`` command."""
import re
from collections import Counter
from fileinput import FileInput

import click

from celery.bin.base import CeleryCommand, handle_preload_options

__all__ = ('logtool',)

RE_LOG_START = re.compile(r'^\[\d\d\d\d\-\d\d-\d\d ')
RE_TASK_RECEIVED = re.compile(r'.+?\] Received')
RE_TASK_READY = re.compile(r'.+?\] Task')
RE_TASK_INFO = re.compile(r'.+?([\w\.]+)\[(.+?)\].+')
RE_TASK_RESULT = re.compile(r'.+?[\w\.]+\[.+?\] (.+)')

REPORT_FORMAT = """
Report
======
Task total: {task[total]}
Task errors: {task[errors]}
Task success: {task[succeeded]}
Task completed: {task[completed]}
Tasks
=====
{task[types].format}
"""


class _task_counts(list):

    @property
    def format(self):
        return '\n'.join('{}: {}'.format(*i) for i in self)


def task_info(line):
    m = RE_TASK_INFO.match(line)
    return m.groups()


class Audit:

    def __init__(self, on_task_error=None, on_trace=None, on_debug=None):
        self.ids = set()
        self.names = {}
        self.results = {}
        self.ready = set()
        self.task_types = Counter()
        self.task_errors = 0
        self.on_task_error = on_task_error
        self.on_trace = on_trace
        self.on_debug = on_debug
        self.prev_line = None

    def run(self, files):
        for line in FileInput(files):
            self.feed(line)
        return self

    def task_received(self, line, task_name, task_id):
        self.names[task_id] = task_name
        self.ids.add(task_id)
        self.task_types[task_name] += 1

    def task_ready(self, line, task_name, task_id, result):
        self.ready.add(task_id)
        self.results[task_id] = result
        if 'succeeded' not in result:
            self.task_error(line, task_name, task_id, result)

    def task_error(self, line, task_name, task_id, result):
        self.task_errors += 1
        if self.on_task_error:
            self.on_task_error(line, task_name, task_id, result)

    def feed(self, line):
        if RE_LOG_START.match(line):
            if RE_TASK_RECEIVED.match(line):
                task_name, task_id = task_info(line)
                self.task_received(line, task_name, task_id)
            elif RE_TASK_READY.match(line):
                task_name, task_id = task_info(line)
                result = RE_TASK_RESULT.match(line)
                if result:
                    result, = result.groups()
                self.task_ready(line, task_name, task_id, result)
            else:
                if self.on_debug:
                    self.on_debug(line)
            self.prev_line = line
        else:
            if self.on_trace:
                self.on_trace('\n'.join(filter(None, [self.prev_line, line])))
            self.prev_line = None

    def incomplete_tasks(self):
        return self.ids ^ self.ready

    def report(self):
        return {
            'task': {
                'types': _task_counts(self.task_types.most_common()),
                'total': len(self.ids),
                'errors': self.task_errors,
                'completed': len(self.ready),
                'succeeded': len(self.ready) - self.task_errors,
            }
        }


@click.group()
@click.pass_context
@handle_preload_options
def logtool(ctx):
    """The ``celery logtool`` command."""


@logtool.command(cls=CeleryCommand)
@click.argument('files', nargs=-1)
@click.pass_context
def stats(ctx, files):
    ctx.obj.echo(REPORT_FORMAT.format(
        **Audit().run(files).report()
    ))


@logtool.command(cls=CeleryCommand)
@click.argument('files', nargs=-1)
@click.pass_context
def traces(ctx, files):
    Audit(on_trace=ctx.obj.echo).run(files)


@logtool.command(cls=CeleryCommand)
@click.argument('files', nargs=-1)
@click.pass_context
def errors(ctx, files):
    Audit(on_task_error=lambda line, *_: ctx.obj.echo(line)).run(files)


@logtool.command(cls=CeleryCommand)
@click.argument('files', nargs=-1)
@click.pass_context
def incomplete(ctx, files):
    audit = Audit()
    audit.run(files)
    for task_id in audit.incomplete_tasks():
        ctx.obj.echo(f'Did not complete: {task_id}')


@logtool.command(cls=CeleryCommand)
@click.argument('files', nargs=-1)
@click.pass_context
def debug(ctx, files):
    Audit(on_debug=ctx.obj.echo).run(files)
