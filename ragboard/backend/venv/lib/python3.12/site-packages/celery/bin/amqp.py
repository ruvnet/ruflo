"""AMQP 0.9.1 REPL."""

import pprint

import click
from amqp import Connection, Message
from click_repl import register_repl

__all__ = ('amqp',)

from celery.bin.base import handle_preload_options


def dump_message(message):
    if message is None:
        return 'No messages in queue. basic.publish something.'
    return {'body': message.body,
            'properties': message.properties,
            'delivery_info': message.delivery_info}


class AMQPContext:
    def __init__(self, cli_context):
        self.cli_context = cli_context
        self.connection = self.cli_context.app.connection()
        self.channel = None
        self.reconnect()

    @property
    def app(self):
        return self.cli_context.app

    def respond(self, retval):
        if isinstance(retval, str):
            self.cli_context.echo(retval)
        else:
            self.cli_context.echo(pprint.pformat(retval))

    def echo_error(self, exception):
        self.cli_context.error(f'{self.cli_context.ERROR}: {exception}')

    def echo_ok(self):
        self.cli_context.echo(self.cli_context.OK)

    def reconnect(self):
        if self.connection:
            self.connection.close()
        else:
            self.connection = self.cli_context.app.connection()

        self.cli_context.echo(f'-> connecting to {self.connection.as_uri()}.')
        try:
            self.connection.connect()
        except (ConnectionRefusedError, ConnectionResetError) as e:
            self.echo_error(e)
        else:
            self.cli_context.secho('-> connected.', fg='green', bold=True)
            self.channel = self.connection.default_channel


@click.group(invoke_without_command=True)
@click.pass_context
@handle_preload_options
def amqp(ctx):
    """AMQP Administration Shell.

    Also works for non-AMQP transports (but not ones that
    store declarations in memory).
    """
    if not isinstance(ctx.obj, AMQPContext):
        ctx.obj = AMQPContext(ctx.obj)


@amqp.command(name='exchange.declare')
@click.argument('exchange',
                type=str)
@click.argument('type',
                type=str)
@click.argument('passive',
                type=bool,
                default=False)
@click.argument('durable',
                type=bool,
                default=False)
@click.argument('auto_delete',
                type=bool,
                default=False)
@click.pass_obj
def exchange_declare(amqp_context, exchange, type, passive, durable,
                     auto_delete):
    if amqp_context.channel is None:
        amqp_context.echo_error('Not connected to broker. Please retry...')
        amqp_context.reconnect()
    else:
        try:
            amqp_context.channel.exchange_declare(exchange=exchange,
                                                  type=type,
                                                  passive=passive,
                                                  durable=durable,
                                                  auto_delete=auto_delete)
        except Exception as e:
            amqp_context.echo_error(e)
            amqp_context.reconnect()
        else:
            amqp_context.echo_ok()


@amqp.command(name='exchange.delete')
@click.argument('exchange',
                type=str)
@click.argument('if_unused',
                type=bool)
@click.pass_obj
def exchange_delete(amqp_context, exchange, if_unused):
    if amqp_context.channel is None:
        amqp_context.echo_error('Not connected to broker. Please retry...')
        amqp_context.reconnect()
    else:
        try:
            amqp_context.channel.exchange_delete(exchange=exchange,
                                                 if_unused=if_unused)
        except Exception as e:
            amqp_context.echo_error(e)
            amqp_context.reconnect()
        else:
            amqp_context.echo_ok()


@amqp.command(name='queue.bind')
@click.argument('queue',
                type=str)
@click.argument('exchange',
                type=str)
@click.argument('routing_key',
                type=str)
@click.pass_obj
def queue_bind(amqp_context, queue, exchange, routing_key):
    if amqp_context.channel is None:
        amqp_context.echo_error('Not connected to broker. Please retry...')
        amqp_context.reconnect()
    else:
        try:
            amqp_context.channel.queue_bind(queue=queue,
                                            exchange=exchange,
                                            routing_key=routing_key)
        except Exception as e:
            amqp_context.echo_error(e)
            amqp_context.reconnect()
        else:
            amqp_context.echo_ok()


@amqp.command(name='queue.declare')
@click.argument('queue',
                type=str)
@click.argument('passive',
                type=bool,
                default=False)
@click.argument('durable',
                type=bool,
                default=False)
@click.argument('auto_delete',
                type=bool,
                default=False)
@click.pass_obj
def queue_declare(amqp_context, queue, passive, durable, auto_delete):
    if amqp_context.channel is None:
        amqp_context.echo_error('Not connected to broker. Please retry...')
        amqp_context.reconnect()
    else:
        try:
            retval = amqp_context.channel.queue_declare(queue=queue,
                                                        passive=passive,
                                                        durable=durable,
                                                        auto_delete=auto_delete)
        except Exception as e:
            amqp_context.echo_error(e)
            amqp_context.reconnect()
        else:
            amqp_context.cli_context.secho(
                'queue:{} messages:{} consumers:{}'.format(*retval),
                fg='cyan', bold=True)
            amqp_context.echo_ok()


@amqp.command(name='queue.delete')
@click.argument('queue',
                type=str)
@click.argument('if_unused',
                type=bool,
                default=False)
@click.argument('if_empty',
                type=bool,
                default=False)
@click.pass_obj
def queue_delete(amqp_context, queue, if_unused, if_empty):
    if amqp_context.channel is None:
        amqp_context.echo_error('Not connected to broker. Please retry...')
        amqp_context.reconnect()
    else:
        try:
            retval = amqp_context.channel.queue_delete(queue=queue,
                                                       if_unused=if_unused,
                                                       if_empty=if_empty)
        except Exception as e:
            amqp_context.echo_error(e)
            amqp_context.reconnect()
        else:
            amqp_context.cli_context.secho(
                f'{retval} messages deleted.',
                fg='cyan', bold=True)
            amqp_context.echo_ok()


@amqp.command(name='queue.purge')
@click.argument('queue',
                type=str)
@click.pass_obj
def queue_purge(amqp_context, queue):
    if amqp_context.channel is None:
        amqp_context.echo_error('Not connected to broker. Please retry...')
        amqp_context.reconnect()
    else:
        try:
            retval = amqp_context.channel.queue_purge(queue=queue)
        except Exception as e:
            amqp_context.echo_error(e)
            amqp_context.reconnect()
        else:
            amqp_context.cli_context.secho(
                f'{retval} messages deleted.',
                fg='cyan', bold=True)
            amqp_context.echo_ok()


@amqp.command(name='basic.get')
@click.argument('queue',
                type=str)
@click.argument('no_ack',
                type=bool,
                default=False)
@click.pass_obj
def basic_get(amqp_context, queue, no_ack):
    if amqp_context.channel is None:
        amqp_context.echo_error('Not connected to broker. Please retry...')
        amqp_context.reconnect()
    else:
        try:
            message = amqp_context.channel.basic_get(queue, no_ack=no_ack)
        except Exception as e:
            amqp_context.echo_error(e)
            amqp_context.reconnect()
        else:
            amqp_context.respond(dump_message(message))
            amqp_context.echo_ok()


@amqp.command(name='basic.publish')
@click.argument('msg',
                type=str)
@click.argument('exchange',
                type=str)
@click.argument('routing_key',
                type=str)
@click.argument('mandatory',
                type=bool,
                default=False)
@click.argument('immediate',
                type=bool,
                default=False)
@click.pass_obj
def basic_publish(amqp_context, msg, exchange, routing_key, mandatory,
                  immediate):
    if amqp_context.channel is None:
        amqp_context.echo_error('Not connected to broker. Please retry...')
        amqp_context.reconnect()
    else:
        # XXX Hack to fix Issue #2013
        if isinstance(amqp_context.connection.connection, Connection):
            msg = Message(msg)
        try:
            amqp_context.channel.basic_publish(msg,
                                               exchange=exchange,
                                               routing_key=routing_key,
                                               mandatory=mandatory,
                                               immediate=immediate)
        except Exception as e:
            amqp_context.echo_error(e)
            amqp_context.reconnect()
        else:
            amqp_context.echo_ok()


@amqp.command(name='basic.ack')
@click.argument('delivery_tag',
                type=int)
@click.pass_obj
def basic_ack(amqp_context, delivery_tag):
    if amqp_context.channel is None:
        amqp_context.echo_error('Not connected to broker. Please retry...')
        amqp_context.reconnect()
    else:
        try:
            amqp_context.channel.basic_ack(delivery_tag)
        except Exception as e:
            amqp_context.echo_error(e)
            amqp_context.reconnect()
        else:
            amqp_context.echo_ok()


register_repl(amqp)
