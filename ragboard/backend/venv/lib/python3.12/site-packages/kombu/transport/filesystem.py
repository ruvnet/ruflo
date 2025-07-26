"""File-system Transport module for kombu.

Transport using the file-system as the message store. Messages written to the
queue are stored in `data_folder_in` directory and
messages read from the queue are read from `data_folder_out` directory. Both
directories must be created manually. Simple example:

* Producer:

.. code-block:: python

    import kombu

    conn = kombu.Connection(
        'filesystem://', transport_options={
            'data_folder_in': 'data_in', 'data_folder_out': 'data_out'
        }
    )
    conn.connect()

    test_queue = kombu.Queue('test', routing_key='test')

    with conn as conn:
        with conn.default_channel as channel:
            producer = kombu.Producer(channel)
            producer.publish(
                        {'hello': 'world'},
                        retry=True,
                        exchange=test_queue.exchange,
                        routing_key=test_queue.routing_key,
                        declare=[test_queue],
                        serializer='pickle'
            )

* Consumer:

.. code-block:: python

    import kombu

    conn = kombu.Connection(
        'filesystem://', transport_options={
            'data_folder_in': 'data_out', 'data_folder_out': 'data_in'
        }
    )
    conn.connect()

    def callback(body, message):
        print(body, message)
        message.ack()

    test_queue = kombu.Queue('test', routing_key='test')

    with conn as conn:
        with conn.default_channel as channel:
            consumer = kombu.Consumer(
                conn, [test_queue], accept=['pickle']
            )
            consumer.register_callback(callback)
            with consumer:
                conn.drain_events(timeout=1)

Features
========
* Type: Virtual
* Supports Direct: Yes
* Supports Topic: Yes
* Supports Fanout: Yes
* Supports Priority: No
* Supports TTL: No

Connection String
=================
Connection string is in the following format:

.. code-block::

    filesystem://

Transport Options
=================
* ``data_folder_in`` - directory where are messages stored when written
  to queue.
* ``data_folder_out`` - directory from which are messages read when read from
  queue.
* ``store_processed`` - if set to True, all processed messages are backed up to
  ``processed_folder``.
* ``processed_folder`` - directory where are backed up processed files.
* ``control_folder`` - directory where are exchange-queue table stored.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import uuid
from collections import namedtuple
from pathlib import Path
from queue import Empty
from time import monotonic

from kombu.exceptions import ChannelError
from kombu.transport import virtual
from kombu.utils.encoding import bytes_to_str, str_to_bytes
from kombu.utils.json import dumps, loads
from kombu.utils.objects import cached_property

VERSION = (1, 0, 0)
__version__ = '.'.join(map(str, VERSION))

# needs win32all to work on Windows
if os.name == 'nt':

    import pywintypes
    import win32con
    import win32file

    LOCK_EX = win32con.LOCKFILE_EXCLUSIVE_LOCK
    # 0 is the default
    LOCK_SH = 0
    LOCK_NB = win32con.LOCKFILE_FAIL_IMMEDIATELY
    __overlapped = pywintypes.OVERLAPPED()

    def lock(file, flags):
        """Create file lock."""
        hfile = win32file._get_osfhandle(file.fileno())
        win32file.LockFileEx(hfile, flags, 0, 0xffff0000, __overlapped)

    def unlock(file):
        """Remove file lock."""
        hfile = win32file._get_osfhandle(file.fileno())
        win32file.UnlockFileEx(hfile, 0, 0xffff0000, __overlapped)


elif os.name == 'posix':

    import fcntl
    from fcntl import LOCK_EX, LOCK_SH

    def lock(file, flags):
        """Create file lock."""
        fcntl.flock(file.fileno(), flags)

    def unlock(file):
        """Remove file lock."""
        fcntl.flock(file.fileno(), fcntl.LOCK_UN)


else:
    raise RuntimeError(
        'Filesystem plugin only defined for NT and POSIX platforms')


exchange_queue_t = namedtuple("exchange_queue_t",
                              ["routing_key", "pattern", "queue"])


class Channel(virtual.Channel):
    """Filesystem Channel."""

    supports_fanout = True

    def get_table(self, exchange):
        file = self.control_folder / f"{exchange}.exchange"
        try:
            f_obj = file.open("r")
            try:
                lock(f_obj, LOCK_SH)
                exchange_table = loads(bytes_to_str(f_obj.read()))
                return [exchange_queue_t(*q) for q in exchange_table]
            finally:
                unlock(f_obj)
                f_obj.close()
        except FileNotFoundError:
            return []
        except OSError:
            raise ChannelError(f"Cannot open {file}")

    def _queue_bind(self, exchange, routing_key, pattern, queue):
        file = self.control_folder / f"{exchange}.exchange"
        self.control_folder.mkdir(exist_ok=True)
        queue_val = exchange_queue_t(routing_key or "", pattern or "",
                                     queue or "")
        try:
            if file.exists():
                f_obj = file.open("rb+", buffering=0)
                lock(f_obj, LOCK_EX)
                exchange_table = loads(bytes_to_str(f_obj.read()))
                queues = [exchange_queue_t(*q) for q in exchange_table]
                if queue_val not in queues:
                    queues.insert(0, queue_val)
                    f_obj.seek(0)
                    f_obj.write(str_to_bytes(dumps(queues)))
            else:
                f_obj = file.open("wb", buffering=0)
                lock(f_obj, LOCK_EX)
                queues = [queue_val]
                f_obj.write(str_to_bytes(dumps(queues)))
        finally:
            unlock(f_obj)
            f_obj.close()

    def _put_fanout(self, exchange, payload, routing_key, **kwargs):
        for q in self.get_table(exchange):
            self._put(q.queue, payload, **kwargs)

    def _put(self, queue, payload, **kwargs):
        """Put `message` onto `queue`."""
        filename = '{}_{}.{}.msg'.format(int(round(monotonic() * 1000)),
                                         uuid.uuid4(), queue)
        filename = os.path.join(self.data_folder_out, filename)

        try:
            f = open(filename, 'wb', buffering=0)
            lock(f, LOCK_EX)
            f.write(str_to_bytes(dumps(payload)))
        except OSError:
            raise ChannelError(
                f'Cannot add file {filename!r} to directory')
        finally:
            unlock(f)
            f.close()

    def _get(self, queue):
        """Get next message from `queue`."""
        queue_find = '.' + queue + '.msg'
        folder = os.listdir(self.data_folder_in)
        folder = sorted(folder)
        while len(folder) > 0:
            filename = folder.pop(0)

            # only handle message for the requested queue
            if filename.find(queue_find) < 0:
                continue

            if self.store_processed:
                processed_folder = self.processed_folder
            else:
                processed_folder = tempfile.gettempdir()

            try:
                # move the file to the tmp/processed folder
                shutil.move(os.path.join(self.data_folder_in, filename),
                            processed_folder)
            except OSError:
                # file could be locked, or removed in meantime so ignore
                continue

            filename = os.path.join(processed_folder, filename)
            try:
                f = open(filename, 'rb')
                payload = f.read()
                f.close()
                if not self.store_processed:
                    os.remove(filename)
            except OSError:
                raise ChannelError(
                    f'Cannot read file {filename!r} from queue.')

            return loads(bytes_to_str(payload))

        raise Empty()

    def _purge(self, queue):
        """Remove all messages from `queue`."""
        count = 0
        queue_find = '.' + queue + '.msg'

        folder = os.listdir(self.data_folder_in)
        while len(folder) > 0:
            filename = folder.pop()
            try:
                # only purge messages for the requested queue
                if filename.find(queue_find) < 0:
                    continue

                filename = os.path.join(self.data_folder_in, filename)
                os.remove(filename)

                count += 1

            except OSError:
                # we simply ignore its existence, as it was probably
                # processed by another worker
                pass

        return count

    def _size(self, queue):
        """Return the number of messages in `queue` as an :class:`int`."""
        count = 0

        queue_find = f'.{queue}.msg'
        folder = os.listdir(self.data_folder_in)
        while len(folder) > 0:
            filename = folder.pop()

            # only handle message for the requested queue
            if filename.find(queue_find) < 0:
                continue

            count += 1

        return count

    @property
    def transport_options(self):
        return self.connection.client.transport_options

    @cached_property
    def data_folder_in(self):
        return self.transport_options.get('data_folder_in', 'data_in')

    @cached_property
    def data_folder_out(self):
        return self.transport_options.get('data_folder_out', 'data_out')

    @cached_property
    def store_processed(self):
        return self.transport_options.get('store_processed', False)

    @cached_property
    def processed_folder(self):
        return self.transport_options.get('processed_folder', 'processed')

    @property
    def control_folder(self):
        return Path(self.transport_options.get('control_folder', 'control'))


class Transport(virtual.Transport):
    """Filesystem Transport."""

    implements = virtual.Transport.implements.extend(
        asynchronous=False,
        exchange_type=frozenset(['direct', 'topic', 'fanout'])
    )

    Channel = Channel
    # filesystem backend state is global.
    global_state = virtual.BrokerState()
    default_port = 0
    driver_type = 'filesystem'
    driver_name = 'filesystem'

    def __init__(self, client, **kwargs):
        super().__init__(client, **kwargs)
        self.state = self.global_state

    def driver_version(self):
        return 'N/A'
