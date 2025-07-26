"""Low-level AMQP client for Python (fork of amqplib)."""
# Copyright (C) 2007-2008 Barry Pederson <bp@barryp.org>

import re
from collections import namedtuple

__version__ = '5.3.1'
__author__ = 'Barry Pederson'
__maintainer__ = 'Asif Saif Uddin, Matus Valo'
__contact__ = 'auvipy@gmail.com'
__homepage__ = 'http://github.com/celery/py-amqp'
__docformat__ = 'restructuredtext'

# -eof meta-

version_info_t = namedtuple('version_info_t', (
    'major', 'minor', 'micro', 'releaselevel', 'serial',
))

# bumpversion can only search for {current_version}
# so we have to parse the version here.
_temp = re.match(
    r'(\d+)\.(\d+).(\d+)(.+)?', __version__).groups()
VERSION = version_info = version_info_t(
    int(_temp[0]), int(_temp[1]), int(_temp[2]), _temp[3] or '', '')
del(_temp)
del(re)

from .basic_message import Message  # noqa
from .channel import Channel  # noqa
from .connection import Connection  # noqa
from .exceptions import (AccessRefused, AMQPError,  # noqa
                         AMQPNotImplementedError, ChannelError, ChannelNotOpen,
                         ConnectionError, ConnectionForced, ConsumerCancelled,
                         ContentTooLarge, FrameError, FrameSyntaxError,
                         InternalError, InvalidCommand, InvalidPath,
                         IrrecoverableChannelError,
                         IrrecoverableConnectionError, NoConsumers, NotAllowed,
                         NotFound, PreconditionFailed, RecoverableChannelError,
                         RecoverableConnectionError, ResourceError,
                         ResourceLocked, UnexpectedFrame, error_for_code)
from .utils import promise  # noqa

__all__ = (
    'Connection',
    'Channel',
    'Message',
    'promise',
    'AMQPError',
    'ConnectionError',
    'RecoverableConnectionError',
    'IrrecoverableConnectionError',
    'ChannelError',
    'RecoverableChannelError',
    'IrrecoverableChannelError',
    'ConsumerCancelled',
    'ContentTooLarge',
    'NoConsumers',
    'ConnectionForced',
    'InvalidPath',
    'AccessRefused',
    'NotFound',
    'ResourceLocked',
    'PreconditionFailed',
    'FrameError',
    'FrameSyntaxError',
    'InvalidCommand',
    'ChannelNotOpen',
    'UnexpectedFrame',
    'ResourceError',
    'NotAllowed',
    'AMQPNotImplementedError',
    'InternalError',
    'error_for_code',
)
