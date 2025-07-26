# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import abc
import typing

from opentelemetry.context.context import Context

CarrierT = typing.TypeVar("CarrierT")
# pylint: disable=invalid-name
CarrierValT = typing.Union[typing.List[str], str]


class Getter(abc.ABC, typing.Generic[CarrierT]):
    """This class implements a Getter that enables extracting propagated
    fields from a carrier.
    """

    @abc.abstractmethod
    def get(
        self, carrier: CarrierT, key: str
    ) -> typing.Optional[typing.List[str]]:
        """Function that can retrieve zero
        or more values from the carrier. In the case that
        the value does not exist, returns None.

        Args:
            carrier: An object which contains values that are used to
                    construct a Context.
            key: key of a field in carrier.
        Returns: first value of the propagation key or None if the key doesn't
                exist.
        """

    @abc.abstractmethod
    def keys(self, carrier: CarrierT) -> typing.List[str]:
        """Function that can retrieve all the keys in a carrier object.

        Args:
            carrier: An object which contains values that are
                used to construct a Context.
        Returns:
            list of keys from the carrier.
        """


class Setter(abc.ABC, typing.Generic[CarrierT]):
    """This class implements a Setter that enables injecting propagated
    fields into a carrier.
    """

    @abc.abstractmethod
    def set(self, carrier: CarrierT, key: str, value: str) -> None:
        """Function that can set a value into a carrier""

        Args:
            carrier: An object which contains values that are used to
                    construct a Context.
            key: key of a field in carrier.
            value: value for a field in carrier.
        """


class DefaultGetter(Getter[typing.Mapping[str, CarrierValT]]):
    def get(
        self, carrier: typing.Mapping[str, CarrierValT], key: str
    ) -> typing.Optional[typing.List[str]]:
        """Getter implementation to retrieve a value from a dictionary.

        Args:
            carrier: dictionary in which to get value
            key: the key used to get the value
        Returns:
            A list with a single string with the value if it exists, else None.
        """
        val = carrier.get(key, None)
        if val is None:
            return None
        if isinstance(val, typing.Iterable) and not isinstance(val, str):
            return list(val)
        return [val]

    def keys(
        self, carrier: typing.Mapping[str, CarrierValT]
    ) -> typing.List[str]:
        """Keys implementation that returns all keys from a dictionary."""
        return list(carrier.keys())


default_getter: Getter[CarrierT] = DefaultGetter()  # type: ignore


class DefaultSetter(Setter[typing.MutableMapping[str, CarrierValT]]):
    def set(
        self,
        carrier: typing.MutableMapping[str, CarrierValT],
        key: str,
        value: CarrierValT,
    ) -> None:
        """Setter implementation to set a value into a dictionary.

        Args:
            carrier: dictionary in which to set value
            key: the key used to set the value
            value: the value to set
        """
        carrier[key] = value


default_setter: Setter[CarrierT] = DefaultSetter()  # type: ignore


class TextMapPropagator(abc.ABC):
    """This class provides an interface that enables extracting and injecting
    context into headers of HTTP requests. HTTP frameworks and clients
    can integrate with TextMapPropagator by providing the object containing the
    headers, and a getter and setter function for the extraction and
    injection of values, respectively.

    """

    @abc.abstractmethod
    def extract(
        self,
        carrier: CarrierT,
        context: typing.Optional[Context] = None,
        getter: Getter[CarrierT] = default_getter,
    ) -> Context:
        """Create a Context from values in the carrier.

        The extract function should retrieve values from the carrier
        object using getter, and use values to populate a
        Context value and return it.

        Args:
            getter: a function that can retrieve zero
                or more values from the carrier. In the case that
                the value does not exist, return an empty list.
            carrier: and object which contains values that are
                used to construct a Context. This object
                must be paired with an appropriate getter
                which understands how to extract a value from it.
            context: an optional Context to use. Defaults to root
                context if not set.
        Returns:
            A Context with configuration found in the carrier.

        """

    @abc.abstractmethod
    def inject(
        self,
        carrier: CarrierT,
        context: typing.Optional[Context] = None,
        setter: Setter[CarrierT] = default_setter,
    ) -> None:
        """Inject values from a Context into a carrier.

        inject enables the propagation of values into HTTP clients or
        other objects which perform an HTTP request. Implementations
        should use the `Setter` 's set method to set values on the
        carrier.

        Args:
            carrier: An object that a place to define HTTP headers.
                Should be paired with setter, which should
                know how to set header values on the carrier.
            context: an optional Context to use. Defaults to current
                context if not set.
            setter: An optional `Setter` object that can set values
                on the carrier.

        """

    @property
    @abc.abstractmethod
    def fields(self) -> typing.Set[str]:
        """
        Gets the fields set in the carrier by the `inject` method.

        If the carrier is reused, its fields that correspond with the ones
        present in this attribute should be deleted before calling `inject`.

        Returns:
            A set with the fields set in `inject`.
        """
