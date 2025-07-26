"""AMQP Messages."""
# Copyright (C) 2007-2008 Barry Pederson <bp@barryp.org>
from .serialization import GenericContent
# Intended to fix #85: ImportError: cannot import name spec
# Encountered on python 2.7.3
# "The submodules often need to refer to each other. For example, the
#  surround [sic] module might use the echo module. In fact, such
#  references are so common that the import statement first looks in
#  the containing package before looking in the standard module search
#  path."
# Source:
#   http://stackoverflow.com/a/14216937/4982251
from .spec import Basic

__all__ = ('Message',)


class Message(GenericContent):
    """A Message for use with the Channel.basic_* methods.

    Expected arg types

        body: string
        children: (not supported)

    Keyword properties may include:

        content_type: shortstr
            MIME content type

        content_encoding: shortstr
            MIME content encoding

        application_headers: table
            Message header field table, a dict with string keys,
            and string | int | Decimal | datetime | dict values.

        delivery_mode: octet
            Non-persistent (1) or persistent (2)

        priority: octet
            The message priority, 0 to 9

        correlation_id: shortstr
            The application correlation identifier

        reply_to: shortstr
            The destination to reply to

        expiration: shortstr
            Message expiration specification

        message_id: shortstr
            The application message identifier

        timestamp: unsigned long
            The message timestamp

        type: shortstr
            The message type name

        user_id: shortstr
            The creating user id

        app_id: shortstr
            The creating application id

        cluster_id: shortstr
            Intra-cluster routing identifier

        Unicode bodies are encoded according to the 'content_encoding'
        argument. If that's None, it's set to 'UTF-8' automatically.

        Example::

            msg = Message('hello world',
                            content_type='text/plain',
                            application_headers={'foo': 7})
    """

    CLASS_ID = Basic.CLASS_ID

    #: Instances of this class have these attributes, which
    #: are passed back and forth as message properties between
    #: client and server
    PROPERTIES = [
        ('content_type', 's'),
        ('content_encoding', 's'),
        ('application_headers', 'F'),
        ('delivery_mode', 'o'),
        ('priority', 'o'),
        ('correlation_id', 's'),
        ('reply_to', 's'),
        ('expiration', 's'),
        ('message_id', 's'),
        ('timestamp', 'L'),
        ('type', 's'),
        ('user_id', 's'),
        ('app_id', 's'),
        ('cluster_id', 's')
    ]

    def __init__(self, body='', children=None, channel=None, **properties):
        super().__init__(**properties)
        #: set by basic_consume/basic_get
        self.delivery_info = None
        self.body = body
        self.channel = channel

    __slots__ = (
        "delivery_info",
        "body",
        "channel",
        )

    @property
    def headers(self):
        return self.properties.get('application_headers')

    @property
    def delivery_tag(self):
        return self.delivery_info.get('delivery_tag')
