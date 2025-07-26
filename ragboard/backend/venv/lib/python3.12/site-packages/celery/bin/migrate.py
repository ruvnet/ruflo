"""The ``celery migrate`` command, used to filter and move messages."""
import click
from kombu import Connection

from celery.bin.base import CeleryCommand, CeleryOption, handle_preload_options
from celery.contrib.migrate import migrate_tasks


@click.command(cls=CeleryCommand)
@click.argument('source')
@click.argument('destination')
@click.option('-n',
              '--limit',
              cls=CeleryOption,
              type=int,
              help_group='Migration Options',
              help='Number of tasks to consume.')
@click.option('-t',
              '--timeout',
              cls=CeleryOption,
              type=float,
              help_group='Migration Options',
              help='Timeout in seconds waiting for tasks.')
@click.option('-a',
              '--ack-messages',
              cls=CeleryOption,
              is_flag=True,
              help_group='Migration Options',
              help='Ack messages from source broker.')
@click.option('-T',
              '--tasks',
              cls=CeleryOption,
              help_group='Migration Options',
              help='List of task names to filter on.')
@click.option('-Q',
              '--queues',
              cls=CeleryOption,
              help_group='Migration Options',
              help='List of queues to migrate.')
@click.option('-F',
              '--forever',
              cls=CeleryOption,
              is_flag=True,
              help_group='Migration Options',
              help='Continually migrate tasks until killed.')
@click.pass_context
@handle_preload_options
def migrate(ctx, source, destination, **kwargs):
    """Migrate tasks from one broker to another.

    Warning:

        This command is experimental, make sure you have a backup of
        the tasks before you continue.
    """
    # TODO: Use a progress bar
    def on_migrate_task(state, body, message):
        ctx.obj.echo(f"Migrating task {state.count}/{state.strtotal}: {body}")

    migrate_tasks(Connection(source),
                  Connection(destination),
                  callback=on_migrate_task,
                  **kwargs)
