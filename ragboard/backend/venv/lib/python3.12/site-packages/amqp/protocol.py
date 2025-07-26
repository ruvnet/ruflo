"""Protocol data."""

from collections import namedtuple

queue_declare_ok_t = namedtuple(
    'queue_declare_ok_t', ('queue', 'message_count', 'consumer_count'),
)

basic_return_t = namedtuple(
    'basic_return_t',
    ('reply_code', 'reply_text', 'exchange', 'routing_key', 'message'),
)
