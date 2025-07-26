"""The ``celery list bindings`` command, used to inspect queue bindings."""
import click

from celery.bin.base import CeleryCommand, handle_preload_options


@click.group(name="list")
@click.pass_context
@handle_preload_options
def list_(ctx):
    """Get info from broker.

    Note:

        For RabbitMQ the management plugin is required.
    """


@list_.command(cls=CeleryCommand)
@click.pass_context
def bindings(ctx):
    """Inspect queue bindings."""
    # TODO: Consider using a table formatter for this command.
    app = ctx.obj.app
    with app.connection() as conn:
        app.amqp.TaskConsumer(conn).declare()

        try:
            bindings = conn.manager.get_bindings()
        except NotImplementedError:
            raise click.UsageError('Your transport cannot list bindings.')

        def fmt(q, e, r):
            ctx.obj.echo(f'{q:<28} {e:<28} {r}')
        fmt('Queue', 'Exchange', 'Routing Key')
        fmt('-' * 16, '-' * 16, '-' * 16)
        for b in bindings:
            fmt(b['destination'], b['source'], b['routing_key'])
