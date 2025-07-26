"""The ``celery upgrade`` command, used to upgrade from previous versions."""
import codecs
import sys

import click

from celery.app import defaults
from celery.bin.base import CeleryCommand, CeleryOption, handle_preload_options
from celery.utils.functional import pass1


@click.group()
@click.pass_context
@handle_preload_options
def upgrade(ctx):
    """Perform upgrade between versions."""


def _slurp(filename):
    # TODO: Handle case when file does not exist
    with codecs.open(filename, 'r', 'utf-8') as read_fh:
        return [line for line in read_fh]


def _compat_key(key, namespace='CELERY'):
    key = key.upper()
    if not key.startswith(namespace):
        key = '_'.join([namespace, key])
    return key


def _backup(filename, suffix='.orig'):
    lines = []
    backup_filename = ''.join([filename, suffix])
    print(f'writing backup to {backup_filename}...',
          file=sys.stderr)
    with codecs.open(filename, 'r', 'utf-8') as read_fh:
        with codecs.open(backup_filename, 'w', 'utf-8') as backup_fh:
            for line in read_fh:
                backup_fh.write(line)
                lines.append(line)
    return lines


def _to_new_key(line, keyfilter=pass1, source=defaults._TO_NEW_KEY):
    # sort by length to avoid, for example, broker_transport overriding
    # broker_transport_options.
    for old_key in reversed(sorted(source, key=lambda x: len(x))):
        new_line = line.replace(old_key, keyfilter(source[old_key]))
        if line != new_line and 'CELERY_CELERY' not in new_line:
            return 1, new_line  # only one match per line.
    return 0, line


@upgrade.command(cls=CeleryCommand)
@click.argument('filename')
@click.option('--django',
              cls=CeleryOption,
              is_flag=True,
              help_group='Upgrading Options',
              help='Upgrade Django project.')
@click.option('--compat',
              cls=CeleryOption,
              is_flag=True,
              help_group='Upgrading Options',
              help='Maintain backwards compatibility.')
@click.option('--no-backup',
              cls=CeleryOption,
              is_flag=True,
              help_group='Upgrading Options',
              help="Don't backup original files.")
def settings(filename, django, compat, no_backup):
    """Migrate settings from Celery 3.x to Celery 4.x."""
    lines = _slurp(filename)
    keyfilter = _compat_key if django or compat else pass1
    print(f'processing {filename}...', file=sys.stderr)
    # gives list of tuples: ``(did_change, line_contents)``
    new_lines = [
        _to_new_key(line, keyfilter) for line in lines
    ]
    if any(n[0] for n in new_lines):  # did have changes
        if not no_backup:
            _backup(filename)
        with codecs.open(filename, 'w', 'utf-8') as write_fh:
            for _, line in new_lines:
                write_fh.write(line)
        print('Changes to your setting have been made!',
              file=sys.stdout)
    else:
        print('Does not seem to require any changes :-)',
              file=sys.stdout)
