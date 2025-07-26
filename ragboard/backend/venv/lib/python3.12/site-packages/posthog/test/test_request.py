import json
import unittest
from datetime import date, datetime

import mock
import pytest
import requests

from posthog.request import (
    DatetimeSerializer,
    QuotaLimitError,
    batch_post,
    decide,
    determine_server_host,
)
from posthog.test.test_utils import TEST_API_KEY


class TestRequests(unittest.TestCase):
    def test_valid_request(self):
        res = batch_post(
            TEST_API_KEY,
            batch=[
                {"distinct_id": "distinct_id", "event": "python event", "type": "track"}
            ],
        )
        self.assertEqual(res.status_code, 200)

    def test_invalid_request_error(self):
        self.assertRaises(
            Exception, batch_post, "testsecret", "https://t.posthog.com", False, "[{]"
        )

    def test_invalid_host(self):
        self.assertRaises(
            Exception, batch_post, "testsecret", "t.posthog.com/", batch=[]
        )

    def test_datetime_serialization(self):
        data = {"created": datetime(2012, 3, 4, 5, 6, 7, 891011)}
        result = json.dumps(data, cls=DatetimeSerializer)
        self.assertEqual(result, '{"created": "2012-03-04T05:06:07.891011"}')

    def test_date_serialization(self):
        today = date.today()
        data = {"created": today}
        result = json.dumps(data, cls=DatetimeSerializer)
        expected = '{"created": "%s"}' % today.isoformat()
        self.assertEqual(result, expected)

    def test_should_not_timeout(self):
        res = batch_post(
            TEST_API_KEY,
            batch=[
                {"distinct_id": "distinct_id", "event": "python event", "type": "track"}
            ],
            timeout=15,
        )
        self.assertEqual(res.status_code, 200)

    def test_should_timeout(self):
        with self.assertRaises(requests.ReadTimeout):
            batch_post(
                "key",
                batch=[
                    {
                        "distinct_id": "distinct_id",
                        "event": "python event",
                        "type": "track",
                    }
                ],
                timeout=0.0001,
            )

    def test_quota_limited_response(self):
        mock_response = requests.Response()
        mock_response.status_code = 200
        mock_response._content = json.dumps(
            {
                "quotaLimited": ["feature_flags"],
                "featureFlags": {},
                "featureFlagPayloads": {},
                "errorsWhileComputingFlags": False,
            }
        ).encode("utf-8")

        with mock.patch("posthog.request._session.post", return_value=mock_response):
            with self.assertRaises(QuotaLimitError) as cm:
                decide("fake_key", "fake_host")

            self.assertEqual(cm.exception.status, 200)
            self.assertEqual(cm.exception.message, "Feature flags quota limited")

    def test_normal_decide_response(self):
        mock_response = requests.Response()
        mock_response.status_code = 200
        mock_response._content = json.dumps(
            {
                "featureFlags": {"flag1": True},
                "featureFlagPayloads": {},
                "errorsWhileComputingFlags": False,
            }
        ).encode("utf-8")

        with mock.patch("posthog.request._session.post", return_value=mock_response):
            response = decide("fake_key", "fake_host")
            self.assertEqual(response["featureFlags"], {"flag1": True})


@pytest.mark.parametrize(
    "host, expected",
    [
        ("https://t.posthog.com", "https://t.posthog.com"),
        ("https://t.posthog.com/", "https://t.posthog.com/"),
        ("t.posthog.com", "t.posthog.com"),
        ("t.posthog.com/", "t.posthog.com/"),
        ("https://us.posthog.com.rg.proxy.com", "https://us.posthog.com.rg.proxy.com"),
        ("app.posthog.com", "app.posthog.com"),
        ("eu.posthog.com", "eu.posthog.com"),
        ("https://app.posthog.com", "https://us.i.posthog.com"),
        ("https://eu.posthog.com", "https://eu.i.posthog.com"),
        ("https://us.posthog.com", "https://us.i.posthog.com"),
        ("https://app.posthog.com/", "https://us.i.posthog.com"),
        ("https://eu.posthog.com/", "https://eu.i.posthog.com"),
        ("https://us.posthog.com/", "https://us.i.posthog.com"),
        (None, "https://us.i.posthog.com"),
    ],
)
def test_routing_to_custom_host(host, expected):
    assert determine_server_host(host) == expected
