"""The ``celery purge`` program, used to delete messages from queues."""
import click

from celery.bin.base import COMMA_SEPARATED_LIST, CeleryCommand, CeleryOption, handle_preload_options
from celery.utils import text


@click.command(cls=CeleryCommand, context_settings={
    'allow_extra_args': True
})
@click.option('-f',
              '--force',
              cls=CeleryOption,
              is_flag=True,
              help_group='Purging Options',
              help="Don't prompt for verification.")
@click.option('-Q',
              '--queues',
              cls=CeleryOption,
              type=COMMA_SEPARATED_LIST,
              help_group='Purging Options',
              help="Comma separated list of queue names to purge.")
@click.option('-X',
              '--exclude-queues',
              cls=CeleryOption,
              type=COMMA_SEPARATED_LIST,
              help_group='Purging Options',
              help="Comma separated list of queues names not to purge.")
@click.pass_context
@handle_preload_options
def purge(ctx, force, queues, exclude_queues, **kwargs):
    """Erase all messages from all known task queues.

    Warning:

        There's no undo operation for this command.
    """
    app = ctx.obj.app
    queues = set(queues or app.amqp.queues.keys())
    exclude_queues = set(exclude_queues or [])
    names = queues - exclude_queues
    qnum = len(names)

    if names:
        queues_headline = text.pluralize(qnum, 'queue')
        if not force:
            queue_names = ', '.join(sorted(names))
            click.confirm(f"{ctx.obj.style('WARNING', fg='red')}:"
                          "This will remove all tasks from "
                          f"{queues_headline}: {queue_names}.\n"
                          "         There is no undo for this operation!\n\n"
                          "(to skip this prompt use the -f option)\n"
                          "Are you sure you want to delete all tasks?",
                          abort=True)

        def _purge(conn, queue):
            try:
                return conn.default_channel.queue_purge(queue) or 0
            except conn.channel_errors:
                return 0

        with app.connection_for_write() as conn:
            messages = sum(_purge(conn, queue) for queue in names)

        if messages:
            messages_headline = text.pluralize(messages, 'message')
            ctx.obj.echo(f"Purged {messages} {messages_headline} from "
                         f"{qnum} known task {queues_headline}.")
        else:
            ctx.obj.echo(f"No messages purged from {qnum} {queues_headline}.")
