import unittest
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

import six
from dateutil.tz import tzutc
from parameterized import parameterized
from pydantic import BaseModel
from pydantic.v1 import BaseModel as BaseModelV1

from posthog import utils

TEST_API_KEY = "kOOlRy2QlMY9jHZQv0bKz0FZyazBUoY8Arj0lFVNjs4"
FAKE_TEST_API_KEY = "random_key"


class TestUtils(unittest.TestCase):
    @parameterized.expand(
        [
            ("naive datetime should be naive", True),
            ("timezone-aware datetime should not be naive", False),
        ]
    )
    def test_is_naive(self, _name: str, expected_naive: bool):
        if expected_naive:
            dt = datetime.now()  # naive datetime
        else:
            dt = datetime.now(tz=tzutc())  # timezone-aware datetime

        assert utils.is_naive(dt) is expected_naive

    def test_timezone_utils(self):
        now = datetime.now()
        utcnow = datetime.now(tz=tzutc())

        fixed = utils.guess_timezone(now)
        assert utils.is_naive(fixed) is False

        shouldnt_be_edited = utils.guess_timezone(utcnow)
        assert utcnow == shouldnt_be_edited

    def test_clean(self):
        simple = {
            "decimal": Decimal("0.142857"),
            "unicode": six.u("woo"),
            "date": datetime.now(),
            "long": 200000000,
            "integer": 1,
            "float": 2.0,
            "bool": True,
            "str": "woo",
            "none": None,
        }

        complicated = {
            "exception": Exception("This should show up"),
            "timedelta": timedelta(microseconds=20),
            "list": [1, 2, 3],
        }

        combined = dict(simple.items())
        combined.update(complicated.items())

        pre_clean_keys = combined.keys()

        utils.clean(combined)
        assert combined.keys() == pre_clean_keys

        # test UUID separately, as the UUID object doesn't equal its string representation according to Python
        assert (
            utils.clean(UUID("12345678123456781234567812345678"))
            == "12345678-1234-5678-1234-567812345678"
        )

    def test_clean_with_dates(self):
        dict_with_dates = {
            "birthdate": date(1980, 1, 1),
            "registration": datetime.now(tz=tzutc()),
        }
        assert dict_with_dates == utils.clean(dict_with_dates)

    def test_bytes(self):
        item = bytes(10)
        utils.clean(item)
        assert utils.clean(item) == "\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"

    def test_clean_fn(self):
        cleaned = utils.clean({"fn": lambda x: x, "number": 4})
        assert cleaned == {"fn": None, "number": 4}

    @parameterized.expand(
        [
            ("http://posthog.io/", "http://posthog.io"),
            ("http://posthog.io", "http://posthog.io"),
            ("https://example.com/path/", "https://example.com/path"),
            ("https://example.com/path", "https://example.com/path"),
        ]
    )
    def test_remove_slash(self, input_url, expected_url):
        assert expected_url == utils.remove_trailing_slash(input_url)

    def test_clean_pydantic(self):
        class ModelV2(BaseModel):
            foo: str
            bar: int
            baz: Optional[str] = None

        class ModelV1(BaseModelV1):
            foo: int
            bar: str

        class NestedModel(BaseModel):
            foo: ModelV2

        assert utils.clean(ModelV2(foo="1", bar=2)) == {
            "foo": "1",
            "bar": 2,
            "baz": None,
        }
        assert utils.clean(ModelV1(foo=1, bar="2")) == {"foo": 1, "bar": "2"}
        assert utils.clean(NestedModel(foo=ModelV2(foo="1", bar=2, baz="3"))) == {
            "foo": {"foo": "1", "bar": 2, "baz": "3"}
        }

    def test_clean_pydantic_like_class(self) -> None:
        class Dummy:
            def model_dump(self, required_param: str) -> dict:
                return {}

        # previously python 2 code would cause an error while cleaning,
        # and this entire object would be None, and we would log an error
        # let's allow ourselves to clean `Dummy` as None,
        # without blatting the `test` key
        assert utils.clean({"test": Dummy()}) == {"test": None}

    def test_clean_dataclass(self):
        @dataclass
        class InnerDataClass:
            inner_foo: str
            inner_bar: int
            inner_uuid: UUID
            inner_date: datetime
            inner_optional: Optional[str] = None

        @dataclass
        class TestDataClass:
            foo: str
            bar: int
            nested: InnerDataClass

        assert utils.clean(
            TestDataClass(
                foo="1",
                bar=2,
                nested=InnerDataClass(
                    inner_foo="3",
                    inner_bar=4,
                    inner_uuid=UUID("12345678123456781234567812345678"),
                    inner_date=datetime(2025, 1, 1),
                ),
            )
        ) == {
            "foo": "1",
            "bar": 2,
            "nested": {
                "inner_foo": "3",
                "inner_bar": 4,
                "inner_uuid": "12345678-1234-5678-1234-567812345678",
                "inner_date": datetime(2025, 1, 1),
                "inner_optional": None,
            },
        }
