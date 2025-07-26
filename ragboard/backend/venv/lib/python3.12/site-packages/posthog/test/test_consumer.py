import json
import time
import unittest

import mock

try:
    from queue import Queue
except ImportError:
    from Queue import Queue

from posthog.consumer import MAX_MSG_SIZE, Consumer
from posthog.request import APIError
from posthog.test.test_utils import TEST_API_KEY


class TestConsumer(unittest.TestCase):
    def test_next(self):
        q = Queue()
        consumer = Consumer(q, "")
        q.put(1)
        next = consumer.next()
        self.assertEqual(next, [1])

    def test_next_limit(self):
        q = Queue()
        flush_at = 50
        consumer = Consumer(q, "", flush_at)
        for i in range(10000):
            q.put(i)
        next = consumer.next()
        self.assertEqual(next, list(range(flush_at)))

    def test_dropping_oversize_msg(self):
        q = Queue()
        consumer = Consumer(q, "")
        oversize_msg = {"m": "x" * MAX_MSG_SIZE}
        q.put(oversize_msg)
        next = consumer.next()
        self.assertEqual(next, [])
        self.assertTrue(q.empty())

    def test_upload(self):
        q = Queue()
        consumer = Consumer(q, TEST_API_KEY)
        track = {"type": "track", "event": "python event", "distinct_id": "distinct_id"}
        q.put(track)
        success = consumer.upload()
        self.assertTrue(success)

    def test_flush_interval(self):
        # Put _n_ items in the queue, pausing a little bit more than
        # _flush_interval_ after each one.
        # The consumer should upload _n_ times.
        q = Queue()
        flush_interval = 0.3
        consumer = Consumer(q, TEST_API_KEY, flush_at=10, flush_interval=flush_interval)
        with mock.patch("posthog.consumer.batch_post") as mock_post:
            consumer.start()
            for i in range(0, 3):
                track = {
                    "type": "track",
                    "event": "python event %d" % i,
                    "distinct_id": "distinct_id",
                }
                q.put(track)
                time.sleep(flush_interval * 1.1)
            self.assertEqual(mock_post.call_count, 3)

    def test_multiple_uploads_per_interval(self):
        # Put _flush_at*2_ items in the queue at once, then pause for
        # _flush_interval_. The consumer should upload 2 times.
        q = Queue()
        flush_interval = 0.5
        flush_at = 10
        consumer = Consumer(
            q, TEST_API_KEY, flush_at=flush_at, flush_interval=flush_interval
        )
        with mock.patch("posthog.consumer.batch_post") as mock_post:
            consumer.start()
            for i in range(0, flush_at * 2):
                track = {
                    "type": "track",
                    "event": "python event %d" % i,
                    "distinct_id": "distinct_id",
                }
                q.put(track)
            time.sleep(flush_interval * 1.1)
            self.assertEqual(mock_post.call_count, 2)

    def test_request(self):
        consumer = Consumer(None, TEST_API_KEY)
        track = {"type": "track", "event": "python event", "distinct_id": "distinct_id"}
        consumer.request([track])

    def _test_request_retry(self, consumer, expected_exception, exception_count):
        def mock_post(*args, **kwargs):
            mock_post.call_count += 1
            if mock_post.call_count <= exception_count:
                raise expected_exception

        mock_post.call_count = 0

        with mock.patch(
            "posthog.consumer.batch_post", mock.Mock(side_effect=mock_post)
        ):
            track = {
                "type": "track",
                "event": "python event",
                "distinct_id": "distinct_id",
            }
            # request() should succeed if the number of exceptions raised is
            # less than the retries paramater.
            if exception_count <= consumer.retries:
                consumer.request([track])
            else:
                # if exceptions are raised more times than the retries
                # parameter, we expect the exception to be returned to
                # the caller.
                try:
                    consumer.request([track])
                except type(expected_exception) as exc:
                    self.assertEqual(exc, expected_exception)
                else:
                    self.fail(
                        "request() should raise an exception if still failing after %d retries"
                        % consumer.retries
                    )

    def test_request_retry(self):
        # we should retry on general errors
        consumer = Consumer(None, TEST_API_KEY)
        self._test_request_retry(consumer, Exception("generic exception"), 2)

        # we should retry on server errors
        consumer = Consumer(None, TEST_API_KEY)
        self._test_request_retry(consumer, APIError(500, "Internal Server Error"), 2)

        # we should retry on HTTP 429 errors
        consumer = Consumer(None, TEST_API_KEY)
        self._test_request_retry(consumer, APIError(429, "Too Many Requests"), 2)

        # we should NOT retry on other client errors
        consumer = Consumer(None, TEST_API_KEY)
        api_error = APIError(400, "Client Errors")
        try:
            self._test_request_retry(consumer, api_error, 1)
        except APIError:
            pass
        else:
            self.fail("request() should not retry on client errors")

        # test for number of exceptions raise > retries value
        consumer = Consumer(None, TEST_API_KEY, retries=3)
        self._test_request_retry(consumer, APIError(500, "Internal Server Error"), 3)

    def test_pause(self):
        consumer = Consumer(None, TEST_API_KEY)
        consumer.pause()
        self.assertFalse(consumer.running)

    def test_max_batch_size(self):
        q = Queue()
        consumer = Consumer(q, TEST_API_KEY, flush_at=100000, flush_interval=3)
        properties = {}
        for n in range(0, 500):
            properties[str(n)] = "one_long_property_value_to_build_a_big_event"
        track = {
            "type": "track",
            "event": "python event",
            "distinct_id": "distinct_id",
            "properties": properties,
        }
        msg_size = len(json.dumps(track).encode())
        # Let's capture 8MB of data to trigger two batches
        n_msgs = int(8_000_000 / msg_size)

        def mock_post_fn(_, data, **kwargs):
            res = mock.Mock()
            res.status_code = 200
            request_size = len(data.encode())
            # Batches close after the first message bringing it bigger than BATCH_SIZE_LIMIT, let's add 10% of margin
            self.assertTrue(
                request_size < (5 * 1024 * 1024) * 1.1,
                "batch size (%d) higher than limit" % request_size,
            )
            return res

        with mock.patch(
            "posthog.request._session.post", side_effect=mock_post_fn
        ) as mock_post:
            consumer.start()
            for _ in range(0, n_msgs + 2):
                q.put(track)
            q.join()
            self.assertEqual(mock_post.call_count, 2)
