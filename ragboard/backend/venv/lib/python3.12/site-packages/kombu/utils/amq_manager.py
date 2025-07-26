"""AMQP Management API utilities."""


from __future__ import annotations


def get_manager(client, hostname=None, port=None, userid=None,
                password=None):
    """Get pyrabbit manager."""
    import pyrabbit
    opt = client.transport_options.get

    def get(name, val, default):
        return (val if val is not None
                else opt('manager_%s' % name) or
                getattr(client, name, None) or default)

    host = get('hostname', hostname, 'localhost')
    port = port if port is not None else opt('manager_port', 15672)
    userid = get('userid', userid, 'guest')
    password = get('password', password, 'guest')
    return pyrabbit.Client(f'{host}:{port}', userid, password)
