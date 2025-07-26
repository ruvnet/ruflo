# Copyright 2012-2014 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
import copy
import logging
from collections import deque, namedtuple

from botocore.compat import accepts_kwargs
from botocore.utils import EVENT_ALIASES

logger = logging.getLogger(__name__)


_NodeList = namedtuple('NodeList', ['first', 'middle', 'last'])
_FIRST = 0
_MIDDLE = 1
_LAST = 2


class NodeList(_NodeList):
    def __copy__(self):
        first_copy = copy.copy(self.first)
        middle_copy = copy.copy(self.middle)
        last_copy = copy.copy(self.last)
        copied = NodeList(first_copy, middle_copy, last_copy)
        return copied


def first_non_none_response(responses, default=None):
    """Find first non None response in a list of tuples.

    This function can be used to find the first non None response from
    handlers connected to an event.  This is useful if you are interested
    in the returned responses from event handlers. Example usage::

        print(first_non_none_response([(func1, None), (func2, 'foo'),
                                       (func3, 'bar')]))
        # This will print 'foo'

    :type responses: list of tuples
    :param responses: The responses from the ``EventHooks.emit`` method.
        This is a list of tuples, and each tuple is
        (handler, handler_response).

    :param default: If no non-None responses are found, then this default
        value will be returned.

    :return: The first non-None response in the list of tuples.

    """
    for response in responses:
        if response[1] is not None:
            return response[1]
    return default


class BaseEventHooks:
    def emit(self, event_name, **kwargs):
        """Call all handlers subscribed to an event.

        :type event_name: str
        :param event_name: The name of the event to emit.

        :type **kwargs: dict
        :param **kwargs: Arbitrary kwargs to pass through to the
            subscribed handlers.  The ``event_name`` will be injected
            into the kwargs so it's not necessary to add this to **kwargs.

        :rtype: list of tuples
        :return: A list of ``(handler_func, handler_func_return_value)``

        """
        return []

    def register(
        self, event_name, handler, unique_id=None, unique_id_uses_count=False
    ):
        """Register an event handler for a given event.

        If a ``unique_id`` is given, the handler will not be registered
        if a handler with the ``unique_id`` has already been registered.

        Handlers are called in the order they have been registered.
        Note handlers can also be registered with ``register_first()``
        and ``register_last()``.  All handlers registered with
        ``register_first()`` are called before handlers registered
        with ``register()`` which are called before handlers registered
        with ``register_last()``.

        """
        self._verify_and_register(
            event_name,
            handler,
            unique_id,
            register_method=self._register,
            unique_id_uses_count=unique_id_uses_count,
        )

    def register_first(
        self, event_name, handler, unique_id=None, unique_id_uses_count=False
    ):
        """Register an event handler to be called first for an event.

        All event handlers registered with ``register_first()`` will
        be called before handlers registered with ``register()`` and
        ``register_last()``.

        """
        self._verify_and_register(
            event_name,
            handler,
            unique_id,
            register_method=self._register_first,
            unique_id_uses_count=unique_id_uses_count,
        )

    def register_last(
        self, event_name, handler, unique_id=None, unique_id_uses_count=False
    ):
        """Register an event handler to be called last for an event.

        All event handlers registered with ``register_last()`` will be called
        after handlers registered with ``register_first()`` and ``register()``.

        """
        self._verify_and_register(
            event_name,
            handler,
            unique_id,
            register_method=self._register_last,
            unique_id_uses_count=unique_id_uses_count,
        )

    def _verify_and_register(
        self,
        event_name,
        handler,
        unique_id,
        register_method,
        unique_id_uses_count,
    ):
        self._verify_is_callable(handler)
        self._verify_accept_kwargs(handler)
        register_method(event_name, handler, unique_id, unique_id_uses_count)

    def unregister(
        self,
        event_name,
        handler=None,
        unique_id=None,
        unique_id_uses_count=False,
    ):
        """Unregister an event handler for a given event.

        If no ``unique_id`` was given during registration, then the
        first instance of the event handler is removed (if the event
        handler has been registered multiple times).

        """
        pass

    def _verify_is_callable(self, func):
        if not callable(func):
            raise ValueError(f"Event handler {func} must be callable.")

    def _verify_accept_kwargs(self, func):
        """Verifies a callable accepts kwargs

        :type func: callable
        :param func: A callable object.

        :returns: True, if ``func`` accepts kwargs, otherwise False.

        """
        try:
            if not accepts_kwargs(func):
                raise ValueError(
                    f"Event handler {func} must accept keyword "
                    f"arguments (**kwargs)"
                )
        except TypeError:
            return False


class HierarchicalEmitter(BaseEventHooks):
    def __init__(self):
        # We keep a reference to the handlers for quick
        # read only access (we never modify self._handlers).
        # A cache of event name to handler list.
        self._lookup_cache = {}
        self._handlers = _PrefixTrie()
        # This is used to ensure that unique_id's are only
        # registered once.
        self._unique_id_handlers = {}

    def _emit(self, event_name, kwargs, stop_on_response=False):
        """
        Emit an event with optional keyword arguments.

        :type event_name: string
        :param event_name: Name of the event
        :type kwargs: dict
        :param kwargs: Arguments to be passed to the handler functions.
        :type stop_on_response: boolean
        :param stop_on_response: Whether to stop on the first non-None
                                response. If False, then all handlers
                                will be called. This is especially useful
                                to handlers which mutate data and then
                                want to stop propagation of the event.
        :rtype: list
        :return: List of (handler, response) tuples from all processed
                 handlers.
        """
        responses = []
        # Invoke the event handlers from most specific
        # to least specific, each time stripping off a dot.
        handlers_to_call = self._lookup_cache.get(event_name)
        if handlers_to_call is None:
            handlers_to_call = self._handlers.prefix_search(event_name)
            self._lookup_cache[event_name] = handlers_to_call
        elif not handlers_to_call:
            # Short circuit and return an empty response is we have
            # no handlers to call.  This is the common case where
            # for the majority of signals, nothing is listening.
            return []
        kwargs['event_name'] = event_name
        responses = []
        for handler in handlers_to_call:
            logger.debug('Event %s: calling handler %s', event_name, handler)
            response = handler(**kwargs)
            responses.append((handler, response))
            if stop_on_response and response is not None:
                return responses
        return responses

    def emit(self, event_name, **kwargs):
        """
        Emit an event by name with arguments passed as keyword args.

            >>> responses = emitter.emit(
            ...     'my-event.service.operation', arg1='one', arg2='two')

        :rtype: list
        :return: List of (handler, response) tuples from all processed
                 handlers.
        """
        return self._emit(event_name, kwargs)

    def emit_until_response(self, event_name, **kwargs):
        """
        Emit an event by name with arguments passed as keyword args,
        until the first non-``None`` response is received. This
        method prevents subsequent handlers from being invoked.

            >>> handler, response = emitter.emit_until_response(
                'my-event.service.operation', arg1='one', arg2='two')

        :rtype: tuple
        :return: The first (handler, response) tuple where the response
                 is not ``None``, otherwise (``None``, ``None``).
        """
        responses = self._emit(event_name, kwargs, stop_on_response=True)
        if responses:
            return responses[-1]
        else:
            return (None, None)

    def _register(
        self, event_name, handler, unique_id=None, unique_id_uses_count=False
    ):
        self._register_section(
            event_name,
            handler,
            unique_id,
            unique_id_uses_count,
            section=_MIDDLE,
        )

    def _register_first(
        self, event_name, handler, unique_id=None, unique_id_uses_count=False
    ):
        self._register_section(
            event_name,
            handler,
            unique_id,
            unique_id_uses_count,
            section=_FIRST,
        )

    def _register_last(
        self, event_name, handler, unique_id, unique_id_uses_count=False
    ):
        self._register_section(
            event_name, handler, unique_id, unique_id_uses_count, section=_LAST
        )

    def _register_section(
        self, event_name, handler, unique_id, unique_id_uses_count, section
    ):
        if unique_id is not None:
            if unique_id in self._unique_id_handlers:
                # We've already registered a handler using this unique_id
                # so we don't need to register it again.
                count = self._unique_id_handlers[unique_id].get('count', None)
                if unique_id_uses_count:
                    if not count:
                        raise ValueError(
                            f"Initial registration of  unique id {unique_id} was "
                            "specified to use a counter. Subsequent register "
                            "calls to unique id must specify use of a counter "
                            "as well."
                        )
                    else:
                        self._unique_id_handlers[unique_id]['count'] += 1
                else:
                    if count:
                        raise ValueError(
                            f"Initial registration of unique id {unique_id} was "
                            "specified to not use a counter. Subsequent "
                            "register calls to unique id must specify not to "
                            "use a counter as well."
                        )
                return
            else:
                # Note that the trie knows nothing about the unique
                # id.  We track uniqueness in this class via the
                # _unique_id_handlers.
                self._handlers.append_item(
                    event_name, handler, section=section
                )
                unique_id_handler_item = {'handler': handler}
                if unique_id_uses_count:
                    unique_id_handler_item['count'] = 1
                self._unique_id_handlers[unique_id] = unique_id_handler_item
        else:
            self._handlers.append_item(event_name, handler, section=section)
        # Super simple caching strategy for now, if we change the registrations
        # clear the cache.  This has the opportunity for smarter invalidations.
        self._lookup_cache = {}

    def unregister(
        self,
        event_name,
        handler=None,
        unique_id=None,
        unique_id_uses_count=False,
    ):
        if unique_id is not None:
            try:
                count = self._unique_id_handlers[unique_id].get('count', None)
            except KeyError:
                # There's no handler matching that unique_id so we have
                # nothing to unregister.
                return
            if unique_id_uses_count:
                if count is None:
                    raise ValueError(
                        f"Initial registration of unique id {unique_id} was specified to "
                        "use a counter. Subsequent unregister calls to unique "
                        "id must specify use of a counter as well."
                    )
                elif count == 1:
                    handler = self._unique_id_handlers.pop(unique_id)[
                        'handler'
                    ]
                else:
                    self._unique_id_handlers[unique_id]['count'] -= 1
                    return
            else:
                if count:
                    raise ValueError(
                        f"Initial registration of unique id {unique_id} was specified "
                        "to not use a counter. Subsequent unregister calls "
                        "to unique id must specify not to use a counter as "
                        "well."
                    )
                handler = self._unique_id_handlers.pop(unique_id)['handler']
        try:
            self._handlers.remove_item(event_name, handler)
            self._lookup_cache = {}
        except ValueError:
            pass

    def __copy__(self):
        new_instance = self.__class__()
        new_state = self.__dict__.copy()
        new_state['_handlers'] = copy.copy(self._handlers)
        new_state['_unique_id_handlers'] = copy.copy(self._unique_id_handlers)
        new_instance.__dict__ = new_state
        return new_instance


class EventAliaser(BaseEventHooks):
    def __init__(self, event_emitter, event_aliases=None):
        self._event_aliases = event_aliases
        if event_aliases is None:
            self._event_aliases = EVENT_ALIASES
        self._alias_name_cache = {}
        self._emitter = event_emitter

    def emit(self, event_name, **kwargs):
        aliased_event_name = self._alias_event_name(event_name)
        return self._emitter.emit(aliased_event_name, **kwargs)

    def emit_until_response(self, event_name, **kwargs):
        aliased_event_name = self._alias_event_name(event_name)
        return self._emitter.emit_until_response(aliased_event_name, **kwargs)

    def register(
        self, event_name, handler, unique_id=None, unique_id_uses_count=False
    ):
        aliased_event_name = self._alias_event_name(event_name)
        return self._emitter.register(
            aliased_event_name, handler, unique_id, unique_id_uses_count
        )

    def register_first(
        self, event_name, handler, unique_id=None, unique_id_uses_count=False
    ):
        aliased_event_name = self._alias_event_name(event_name)
        return self._emitter.register_first(
            aliased_event_name, handler, unique_id, unique_id_uses_count
        )

    def register_last(
        self, event_name, handler, unique_id=None, unique_id_uses_count=False
    ):
        aliased_event_name = self._alias_event_name(event_name)
        return self._emitter.register_last(
            aliased_event_name, handler, unique_id, unique_id_uses_count
        )

    def unregister(
        self,
        event_name,
        handler=None,
        unique_id=None,
        unique_id_uses_count=False,
    ):
        aliased_event_name = self._alias_event_name(event_name)
        return self._emitter.unregister(
            aliased_event_name, handler, unique_id, unique_id_uses_count
        )

    def _alias_event_name(self, event_name):
        if event_name in self._alias_name_cache:
            return self._alias_name_cache[event_name]

        for old_part, new_part in self._event_aliases.items():
            # We can't simply do a string replace for everything, otherwise we
            # might end up translating substrings that we never intended to
            # translate. When there aren't any dots in the old event name
            # part, then we can quickly replace the item in the list if it's
            # there.
            event_parts = event_name.split('.')
            if '.' not in old_part:
                try:
                    # Theoretically a given event name could have the same part
                    # repeated, but in practice this doesn't happen
                    event_parts[event_parts.index(old_part)] = new_part
                except ValueError:
                    continue

            # If there's dots in the name, it gets more complicated. Now we
            # have to replace multiple sections of the original event.
            elif old_part in event_name:
                old_parts = old_part.split('.')
                self._replace_subsection(event_parts, old_parts, new_part)
            else:
                continue

            new_name = '.'.join(event_parts)
            logger.debug(
                f"Changing event name from {event_name} to {new_name}"
            )
            self._alias_name_cache[event_name] = new_name
            return new_name

        self._alias_name_cache[event_name] = event_name
        return event_name

    def _replace_subsection(self, sections, old_parts, new_part):
        for i in range(len(sections)):
            if (
                sections[i] == old_parts[0]
                and sections[i : i + len(old_parts)] == old_parts
            ):
                sections[i : i + len(old_parts)] = [new_part]
                return

    def __copy__(self):
        return self.__class__(
            copy.copy(self._emitter), copy.copy(self._event_aliases)
        )


class _PrefixTrie:
    """Specialized prefix trie that handles wildcards.

    The prefixes in this case are based on dot separated
    names so 'foo.bar.baz' is::

        foo -> bar -> baz

    Wildcard support just means that having a key such as 'foo.bar.*.baz' will
    be matched with a call to ``get_items(key='foo.bar.ANYTHING.baz')``.

    You can think of this prefix trie as the equivalent as defaultdict(list),
    except that it can do prefix searches:

        foo.bar.baz -> A
        foo.bar -> B
        foo -> C

    Calling ``get_items('foo.bar.baz')`` will return [A + B + C], from
    most specific to least specific.

    """

    def __init__(self):
        # Each dictionary can be though of as a node, where a node
        # has values associated with the node, and children is a link
        # to more nodes.  So 'foo.bar' would have a 'foo' node with
        # a 'bar' node as a child of foo.
        # {'foo': {'children': {'bar': {...}}}}.
        self._root = {'chunk': None, 'children': {}, 'values': None}

    def append_item(self, key, value, section=_MIDDLE):
        """Add an item to a key.

        If a value is already associated with that key, the new
        value is appended to the list for the key.
        """
        key_parts = key.split('.')
        current = self._root
        for part in key_parts:
            if part not in current['children']:
                new_child = {'chunk': part, 'values': None, 'children': {}}
                current['children'][part] = new_child
                current = new_child
            else:
                current = current['children'][part]
        if current['values'] is None:
            current['values'] = NodeList([], [], [])
        current['values'][section].append(value)

    def prefix_search(self, key):
        """Collect all items that are prefixes of key.

        Prefix in this case are delineated by '.' characters so
        'foo.bar.baz' is a 3 chunk sequence of 3 "prefixes" (
        "foo", "bar", and "baz").

        """
        collected = deque()
        key_parts = key.split('.')
        current = self._root
        self._get_items(current, key_parts, collected, 0)
        return collected

    def _get_items(self, starting_node, key_parts, collected, starting_index):
        stack = [(starting_node, starting_index)]
        key_parts_len = len(key_parts)
        # Traverse down the nodes, where at each level we add the
        # next part from key_parts as well as the wildcard element '*'.
        # This means for each node we see we potentially add two more
        # elements to our stack.
        while stack:
            current_node, index = stack.pop()
            if current_node['values']:
                # We're using extendleft because we want
                # the values associated with the node furthest
                # from the root to come before nodes closer
                # to the root.  extendleft() also adds its items
                # in right-left order so .extendleft([1, 2, 3])
                # will result in final_list = [3, 2, 1], which is
                # why we reverse the lists.
                node_list = current_node['values']
                complete_order = (
                    node_list.first + node_list.middle + node_list.last
                )
                collected.extendleft(reversed(complete_order))
            if not index == key_parts_len:
                children = current_node['children']
                directs = children.get(key_parts[index])
                wildcard = children.get('*')
                next_index = index + 1
                if wildcard is not None:
                    stack.append((wildcard, next_index))
                if directs is not None:
                    stack.append((directs, next_index))

    def remove_item(self, key, value):
        """Remove an item associated with a key.

        If the value is not associated with the key a ``ValueError``
        will be raised.  If the key does not exist in the trie, a
        ``ValueError`` will be raised.

        """
        key_parts = key.split('.')
        current = self._root
        self._remove_item(current, key_parts, value, index=0)

    def _remove_item(self, current_node, key_parts, value, index):
        if current_node is None:
            return
        elif index < len(key_parts):
            next_node = current_node['children'].get(key_parts[index])
            if next_node is not None:
                self._remove_item(next_node, key_parts, value, index + 1)
                if index == len(key_parts) - 1:
                    node_list = next_node['values']
                    if value in node_list.first:
                        node_list.first.remove(value)
                    elif value in node_list.middle:
                        node_list.middle.remove(value)
                    elif value in node_list.last:
                        node_list.last.remove(value)
                if not next_node['children'] and not next_node['values']:
                    # Then this is a leaf node with no values so
                    # we can just delete this link from the parent node.
                    # This makes subsequent search faster in the case
                    # where a key does not exist.
                    del current_node['children'][key_parts[index]]
            else:
                raise ValueError(f"key is not in trie: {'.'.join(key_parts)}")

    def __copy__(self):
        # The fact that we're using a nested dict under the covers
        # is an implementation detail, and the user shouldn't have
        # to know that they'd normally need a deepcopy so we expose
        # __copy__ instead of __deepcopy__.
        new_copy = self.__class__()
        copied_attrs = self._recursive_copy(self.__dict__)
        new_copy.__dict__ = copied_attrs
        return new_copy

    def _recursive_copy(self, node):
        # We can't use copy.deepcopy because we actually only want to copy
        # the structure of the trie, not the handlers themselves.
        # Each node has a chunk, children, and values.
        copied_node = {}
        for key, value in node.items():
            if isinstance(value, NodeList):
                copied_node[key] = copy.copy(value)
            elif isinstance(value, dict):
                copied_node[key] = self._recursive_copy(value)
            else:
                copied_node[key] = value
        return copied_node
