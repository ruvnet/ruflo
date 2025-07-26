"""Amazon SQS queue implementation."""

from __future__ import annotations

from vine import transform

from .message import AsyncMessage

_all__ = ['AsyncQueue']


def list_first(rs):
    """Get the first item in a list, or None if list empty."""
    return rs[0] if len(rs) == 1 else None


class AsyncQueue:
    """Async SQS Queue."""

    def __init__(self, connection=None, url=None, message_class=AsyncMessage):
        self.connection = connection
        self.url = url
        self.message_class = message_class
        self.visibility_timeout = None

    def _NA(self, *args, **kwargs):
        raise NotImplementedError()
    count_slow = dump = save_to_file = save_to_filename = save = \
        save_to_s3 = load_from_s3 = load_from_file = load_from_filename = \
        load = clear = _NA

    def get_attributes(self, attributes='All', callback=None):
        return self.connection.get_queue_attributes(
            self, attributes, callback,
        )

    def set_attribute(self, attribute, value, callback=None):
        return self.connection.set_queue_attribute(
            self, attribute, value, callback,
        )

    def get_timeout(self, callback=None, _attr='VisibilityTimeout'):
        return self.get_attributes(
            _attr, transform(
                self._coerce_field_value, callback, _attr, int,
            ),
        )

    def _coerce_field_value(self, key, type, response):
        return type(response[key])

    def set_timeout(self, visibility_timeout, callback=None):
        return self.set_attribute(
            'VisibilityTimeout', visibility_timeout,
            transform(
                self._on_timeout_set, callback,
            )
        )

    def _on_timeout_set(self, visibility_timeout):
        if visibility_timeout:
            self.visibility_timeout = visibility_timeout
        return self.visibility_timeout

    def add_permission(self, label, aws_account_id, action_name,
                       callback=None):
        return self.connection.add_permission(
            self, label, aws_account_id, action_name, callback,
        )

    def remove_permission(self, label, callback=None):
        return self.connection.remove_permission(self, label, callback)

    def read(self, visibility_timeout=None, wait_time_seconds=None,
             callback=None):
        return self.get_messages(
            1, visibility_timeout,
            wait_time_seconds=wait_time_seconds,
            callback=transform(list_first, callback),
        )

    def write(self, message, delay_seconds=None, callback=None):
        return self.connection.send_message(
            self, message.get_body_encoded(), delay_seconds,
            callback=transform(self._on_message_sent, callback, message),
        )

    def write_batch(self, messages, callback=None):
        return self.connection.send_message_batch(
            self, messages, callback=callback,
        )

    def _on_message_sent(self, orig_message, new_message):
        orig_message.id = new_message.id
        orig_message.md5 = new_message.md5
        return new_message

    def get_messages(self, num_messages=1, visibility_timeout=None,
                     attributes=None, wait_time_seconds=None, callback=None):
        return self.connection.receive_message(
            self, number_messages=num_messages,
            visibility_timeout=visibility_timeout,
            attributes=attributes,
            wait_time_seconds=wait_time_seconds,
            callback=callback,
        )

    def delete_message(self, message, callback=None):
        return self.connection.delete_message(self, message, callback)

    def delete_message_batch(self, messages, callback=None):
        return self.connection.delete_message_batch(
            self, messages, callback=callback,
        )

    def change_message_visibility_batch(self, messages, callback=None):
        return self.connection.change_message_visibility_batch(
            self, messages, callback=callback,
        )

    def delete(self, callback=None):
        return self.connection.delete_queue(self, callback=callback)

    def count(self, page_size=10, vtimeout=10, callback=None,
              _attr='ApproximateNumberOfMessages'):
        return self.get_attributes(
            _attr, callback=transform(
                self._coerce_field_value, callback, _attr, int,
            ),
        )
