"""JSON Serialization Utilities."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Callable, TypeVar

textual_types = ()

try:
    from django.utils.functional import Promise

    textual_types += (Promise,)
except ImportError:
    pass


class JSONEncoder(json.JSONEncoder):
    """Kombu custom json encoder."""

    def default(self, o):
        reducer = getattr(o, "__json__", None)
        if reducer is not None:
            return reducer()

        if isinstance(o, textual_types):
            return str(o)

        for t, (marker, encoder) in _encoders.items():
            if isinstance(o, t):
                return (
                    encoder(o) if marker is None else _as(marker, encoder(o))
                )

        # Bytes is slightly trickier, so we cannot put them directly
        # into _encoders, because we use two formats: bytes, and base64.
        if isinstance(o, bytes):
            try:
                return _as("bytes", o.decode("utf-8"))
            except UnicodeDecodeError:
                return _as("base64", base64.b64encode(o).decode("utf-8"))

        return super().default(o)


def _as(t: str, v: Any):
    return {"__type__": t, "__value__": v}


def dumps(
    s,
    _dumps=json.dumps,
    cls=JSONEncoder,
    default_kwargs=None,
    **kwargs
):
    """Serialize object to json string."""
    default_kwargs = default_kwargs or {}
    return _dumps(s, cls=cls, **dict(default_kwargs, **kwargs))


def object_hook(o: dict):
    """Hook function to perform custom deserialization."""
    if o.keys() == {"__type__", "__value__"}:
        decoder = _decoders.get(o["__type__"])
        if decoder:
            return decoder(o["__value__"])
        else:
            raise ValueError("Unsupported type", type, o)
    else:
        return o


def loads(s, _loads=json.loads, decode_bytes=True, object_hook=object_hook):
    """Deserialize json from string."""
    # None of the json implementations supports decoding from
    # a buffer/memoryview, or even reading from a stream
    #    (load is just loads(fp.read()))
    # but this is Python, we love copying strings, preferably many times
    # over.  Note that pickle does support buffer/memoryview
    # </rant>
    if isinstance(s, memoryview):
        s = s.tobytes().decode("utf-8")
    elif isinstance(s, bytearray):
        s = s.decode("utf-8")
    elif decode_bytes and isinstance(s, bytes):
        s = s.decode("utf-8")

    return _loads(s, object_hook=object_hook)


DecoderT = EncoderT = Callable[[Any], Any]
T = TypeVar("T")
EncodedT = TypeVar("EncodedT")


def register_type(
    t: type[T],
    marker: str | None,
    encoder: Callable[[T], EncodedT],
    decoder: Callable[[EncodedT], T] = lambda d: d,
):
    """Add support for serializing/deserializing native python type.

    If marker is `None`, the encoding is a pure transformation and the result
    is not placed in an envelope, so `decoder` is unnecessary. Decoding must
    instead be handled outside this library.
    """
    _encoders[t] = (marker, encoder)
    if marker is not None:
        _decoders[marker] = decoder


_encoders: dict[type, tuple[str | None, EncoderT]] = {}
_decoders: dict[str, DecoderT] = {
    "bytes": lambda o: o.encode("utf-8"),
    "base64": lambda o: base64.b64decode(o.encode("utf-8")),
}


def _register_default_types():
    # NOTE: datetime should be registered before date,
    # because datetime is also instance of date.
    register_type(datetime, "datetime", datetime.isoformat,
                  datetime.fromisoformat)
    register_type(
        date,
        "date",
        lambda o: o.isoformat(),
        lambda o: datetime.fromisoformat(o).date(),
    )
    register_type(time, "time", lambda o: o.isoformat(), time.fromisoformat)
    register_type(Decimal, "decimal", str, Decimal)
    register_type(
        uuid.UUID,
        "uuid",
        lambda o: {"hex": o.hex},
        lambda o: uuid.UUID(**o),
    )


_register_default_types()
