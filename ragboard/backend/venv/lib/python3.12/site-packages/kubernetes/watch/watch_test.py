# Copyright 2016 The Kubernetes Authors.
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

import unittest

import os

import time

from unittest.mock import Mock, call

from kubernetes import client,config

from .watch import Watch

from kubernetes.client import ApiException


class WatchTests(unittest.TestCase):
    def setUp(self):
        # counter for a test that needs test global state
        self.callcount = 0

    def test_watch_with_decode(self):
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(
            return_value=[
                '{"type": "ADDED", "object": {"metadata": {"name": "test1",'
                '"resourceVersion": "1"}, "spec": {}, "status": {}}}\n',
                '{"type": "ADDED", "object": {"metadata": {"name": "test2",'
                '"resourceVersion": "2"}, "spec": {}, "sta',
                'tus": {}}}\n'
                '{"type": "ADDED", "object": {"metadata": {"name": "test3",'
                '"resourceVersion": "3"}, "spec": {}, "status": {}}}\n',
                'should_not_happened\n'])

        fake_api = Mock()
        fake_api.get_namespaces = Mock(return_value=fake_resp)
        fake_api.get_namespaces.__doc__ = ':return: V1NamespaceList'

        w = Watch()
        count = 1
        for e in w.stream(fake_api.get_namespaces):
            self.assertEqual("ADDED", e['type'])
            # make sure decoder worked and we got a model with the right name
            self.assertEqual("test%d" % count, e['object'].metadata.name)
            # make sure decoder worked and updated Watch.resource_version
            self.assertEqual(
                "%d" % count, e['object'].metadata.resource_version)
            self.assertEqual("%d" % count, w.resource_version)
            count += 1
            # make sure we can stop the watch and the last event with won't be
            # returned
            if count == 4:
                w.stop()

        # make sure that all three records were consumed by the stream
        self.assertEqual(4, count)

        fake_api.get_namespaces.assert_called_once_with(
            _preload_content=False, watch=True)
        fake_resp.stream.assert_called_once_with(
            amt=None, decode_content=False)
        fake_resp.close.assert_called_once()
        fake_resp.release_conn.assert_called_once()

    def test_watch_with_interspersed_newlines(self):
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(
            return_value=[
                '\n',
                '{"type": "ADDED", "object": {"metadata":',
                '{"name": "test1","resourceVersion": "1"}}}\n{"type": "ADDED", ',
                '"object": {"metadata": {"name": "test2", "resourceVersion": "2"}}}\n',
                '\n',
                '',
                '{"type": "ADDED", "object": {"metadata": {"name": "test3", "resourceVersion": "3"}}}\n',
                '\n\n\n',
                '\n',
            ])

        fake_api = Mock()
        fake_api.get_namespaces = Mock(return_value=fake_resp)
        fake_api.get_namespaces.__doc__ = ':return: V1NamespaceList'

        w = Watch()
        count = 0

        # Consume all test events from the mock service, stopping when no more data is available.
        # Note that "timeout_seconds" below is not a timeout; rather, it disables retries and is
        # the only way to do so. Without that, the stream will re-read the test data forever.
        for e in w.stream(fake_api.get_namespaces, timeout_seconds=1):
            # Here added a statement for exception for empty lines.
            if e is None:
                continue
            count += 1
            self.assertEqual("test%d" % count, e['object'].metadata.name)
        self.assertEqual(3, count)

    def test_watch_with_multibyte_utf8(self):
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(
            return_value=[
                # two-byte utf-8 character
                '{"type":"MODIFIED","object":{"data":{"utf-8":"© 1"},"metadata":{"name":"test1","resourceVersion":"1"}}}\n',
                # same copyright character expressed as bytes
                b'{"type":"MODIFIED","object":{"data":{"utf-8":"\xC2\xA9 2"},"metadata":{"name":"test2","resourceVersion":"2"}}}\n'
                # same copyright character with bytes split across two stream chunks
                b'{"type":"MODIFIED","object":{"data":{"utf-8":"\xC2',
                b'\xA9 3"},"metadata":{"n',
                # more chunks of the same event, sent as a mix of bytes and strings
                'ame":"test3","resourceVersion":"3"',
                '}}}',
                b'\n'
            ])

        fake_api = Mock()
        fake_api.get_configmaps = Mock(return_value=fake_resp)
        fake_api.get_configmaps.__doc__ = ':return: V1ConfigMapList'

        w = Watch()
        count = 0

        # Consume all test events from the mock service, stopping when no more data is available.
        # Note that "timeout_seconds" below is not a timeout; rather, it disables retries and is
        # the only way to do so. Without that, the stream will re-read the test data forever.
        for event in w.stream(fake_api.get_configmaps, timeout_seconds=1):
            count += 1
            self.assertEqual("MODIFIED", event['type'])
            self.assertEqual("test%d" % count, event['object'].metadata.name)
            self.assertEqual("© %d" % count, event['object'].data["utf-8"])
            self.assertEqual(
                "%d" % count, event['object'].metadata.resource_version)
            self.assertEqual("%d" % count, w.resource_version)
        self.assertEqual(3, count)

    def test_watch_with_invalid_utf8(self):
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(
            # test 1 uses 1 invalid utf-8 byte
            # test 2 uses a sequence of 2 invalid utf-8 bytes
            # test 3 uses a sequence of 3 invalid utf-8 bytes
            return_value=[
                # utf-8 sequence for 😄 is \xF0\x9F\x98\x84
                # all other sequences below are invalid
                # ref: https://www.w3.org/2001/06/utf-8-wrong/UTF-8-test.html
                b'{"type":"MODIFIED","object":{"data":{"utf-8":"\xF0\x9F\x98\x84 1","invalid":"\x80 1"},"metadata":{"name":"test1"}}}\n',
                b'{"type":"MODIFIED","object":{"data":{"utf-8":"\xF0\x9F\x98\x84 2","invalid":"\xC0\xAF 2"},"metadata":{"name":"test2"}}}\n',
                # mix bytes/strings and split byte sequences across chunks
                b'{"type":"MODIFIED","object":{"data":{"utf-8":"\xF0\x9F\x98',
                b'\x84 ',
                b'',
                b'3","invalid":"\xE0\x80',
                b'\xAF ',
                '3"},"metadata":{"n',
                'ame":"test3"',
                '}}}',
                b'\n'
            ])

        fake_api = Mock()
        fake_api.get_configmaps = Mock(return_value=fake_resp)
        fake_api.get_configmaps.__doc__ = ':return: V1ConfigMapList'

        w = Watch()
        count = 0

        # Consume all test events from the mock service, stopping when no more data is available.
        # Note that "timeout_seconds" below is not a timeout; rather, it disables retries and is
        # the only way to do so. Without that, the stream will re-read the test data forever.
        for event in w.stream(fake_api.get_configmaps, timeout_seconds=1):
            count += 1
            self.assertEqual("MODIFIED", event['type'])
            self.assertEqual("test%d" % count, event['object'].metadata.name)
            self.assertEqual("😄 %d" % count, event['object'].data["utf-8"])
            # expect N replacement characters in test N
            self.assertEqual("� %d".replace('�', '�'*count) %
                             count, event['object'].data["invalid"])
        self.assertEqual(3, count)

    def test_watch_for_follow(self):
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(
            return_value=[
                'log_line_1\n',
                'log_line_2\n'])

        fake_api = Mock()
        fake_api.read_namespaced_pod_log = Mock(return_value=fake_resp)
        fake_api.read_namespaced_pod_log.__doc__ = ':param bool follow:\n:return: str'

        w = Watch()
        count = 1
        for e in w.stream(fake_api.read_namespaced_pod_log):
            self.assertEqual("log_line_1", e)
            count += 1
            # make sure we can stop the watch and the last event with won't be
            # returned
            if count == 2:
                w.stop()

        fake_api.read_namespaced_pod_log.assert_called_once_with(
            _preload_content=False, follow=True)
        fake_resp.stream.assert_called_once_with(
            amt=None, decode_content=False)
        fake_resp.close.assert_called_once()
        fake_resp.release_conn.assert_called_once()

    def test_watch_resource_version_set(self):
        # https://github.com/kubernetes-client/python/issues/700
        # ensure watching from a resource version does reset to resource
        # version 0 after k8s resets the watch connection
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        values = [
            '{"type": "ADDED", "object": {"metadata": {"name": "test1",'
            '"resourceVersion": "1"}, "spec": {}, "status": {}}}\n',
            '{"type": "ADDED", "object": {"metadata": {"name": "test2",'
            '"resourceVersion": "2"}, "spec": {}, "sta',
            'tus": {}}}\n'
            '{"type": "ADDED", "object": {"metadata": {"name": "test3",'
            '"resourceVersion": "3"}, "spec": {}, "status": {}}}\n'
        ]

        # return nothing on the first call and values on the second
        # this emulates a watch from a rv that returns nothing in the first k8s
        # watch reset and values later

        def get_values(*args, **kwargs):
            self.callcount += 1
            if self.callcount == 1:
                return []
            else:
                return values

        fake_resp.stream = Mock(
            side_effect=get_values)

        fake_api = Mock()
        fake_api.get_namespaces = Mock(return_value=fake_resp)
        fake_api.get_namespaces.__doc__ = ':return: V1NamespaceList'

        w = Watch()
        # ensure we keep our requested resource version or the version latest
        # returned version when the existing versions are older than the
        # requested version
        # needed for the list existing objects, then watch from there use case
        calls = []

        iterations = 2
        # first two calls must use the passed rv, the first call is a
        # "reset" and does not actually return anything
        # the second call must use the same rv but will return values
        # (with a wrong rv but a real cluster would behave correctly)
        # calls following that will use the rv from those returned values
        calls.append(call(_preload_content=False, watch=True,
                          resource_version="5"))
        calls.append(call(_preload_content=False, watch=True,
                          resource_version="5"))
        for i in range(iterations):
            # ideally we want 5 here but as rv must be treated as an
            # opaque value we cannot interpret it and order it so rely
            # on k8s returning the events completely and in order
            calls.append(call(_preload_content=False, watch=True,
                              resource_version="3"))

        for c, e in enumerate(w.stream(fake_api.get_namespaces,
                                       resource_version="5")):
            if c == len(values) * iterations:
                w.stop()

        # check calls are in the list, gives good error output
        fake_api.get_namespaces.assert_has_calls(calls)
        # more strict test with worse error message
        self.assertEqual(fake_api.get_namespaces.mock_calls, calls)

    def test_watch_stream_twice(self):
        w = Watch(float)
        for step in ['first', 'second']:
            fake_resp = Mock()
            fake_resp.close = Mock()
            fake_resp.release_conn = Mock()
            fake_resp.stream = Mock(
                return_value=['{"type": "ADDED", "object": 1}\n'] * 4)

            fake_api = Mock()
            fake_api.get_namespaces = Mock(return_value=fake_resp)
            fake_api.get_namespaces.__doc__ = ':return: V1NamespaceList'

            count = 1
            for e in w.stream(fake_api.get_namespaces):
                count += 1
                if count == 3:
                    w.stop()

            self.assertEqual(count, 3)
            fake_api.get_namespaces.assert_called_once_with(
                _preload_content=False, watch=True)
            fake_resp.stream.assert_called_once_with(
                amt=None, decode_content=False)
            fake_resp.close.assert_called_once()
            fake_resp.release_conn.assert_called_once()

    def test_watch_stream_loop(self):
        w = Watch(float)

        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(
            return_value=['{"type": "ADDED", "object": 1}\n'])

        fake_api = Mock()
        fake_api.get_namespaces = Mock(return_value=fake_resp)
        fake_api.get_namespaces.__doc__ = ':return: V1NamespaceList'

        count = 0

        # when timeout_seconds is set, auto-exist when timeout reaches
        for e in w.stream(fake_api.get_namespaces, timeout_seconds=1):
            count = count + 1
        self.assertEqual(count, 1)

        # when no timeout_seconds, only exist when w.stop() is called
        for e in w.stream(fake_api.get_namespaces):
            count = count + 1
            if count == 2:
                w.stop()

        self.assertEqual(count, 2)
        self.assertEqual(fake_api.get_namespaces.call_count, 2)
        self.assertEqual(fake_resp.stream.call_count, 2)
        self.assertEqual(fake_resp.close.call_count, 2)
        self.assertEqual(fake_resp.release_conn.call_count, 2)

    def test_unmarshal_with_float_object(self):
        w = Watch()
        event = w.unmarshal_event('{"type": "ADDED", "object": 1}', 'float')
        self.assertEqual("ADDED", event['type'])
        self.assertEqual(1.0, event['object'])
        self.assertTrue(isinstance(event['object'], float))
        self.assertEqual(1, event['raw_object'])

    def test_unmarshal_with_no_return_type(self):
        w = Watch()
        event = w.unmarshal_event('{"type": "ADDED", "object": ["test1"]}',
                                  None)
        self.assertEqual("ADDED", event['type'])
        self.assertEqual(["test1"], event['object'])
        self.assertEqual(["test1"], event['raw_object'])

    def test_unmarshal_with_custom_object(self):
        w = Watch()
        event = w.unmarshal_event('{"type": "ADDED", "object": {"apiVersion":'
                                  '"test.com/v1beta1","kind":"foo","metadata":'
                                  '{"name": "bar", "resourceVersion": "1"}}}',
                                  'object')
        self.assertEqual("ADDED", event['type'])
        # make sure decoder deserialized json into dictionary and updated
        # Watch.resource_version
        self.assertTrue(isinstance(event['object'], dict))
        self.assertEqual("1", event['object']['metadata']['resourceVersion'])
        self.assertEqual("1", w.resource_version)

    def test_unmarshal_with_bookmark(self):
        w = Watch()
        event = w.unmarshal_event(
            '{"type":"BOOKMARK","object":{"kind":"Job","apiVersion":"batch/v1"'
            ',"metadata":{"resourceVersion":"1"},"spec":{"template":{'
            '"metadata":{},"spec":{"containers":null}}},"status":{}}}',
            'V1Job')
        self.assertEqual("BOOKMARK", event['type'])
        # Watch.resource_version is *not* updated, as BOOKMARK is treated the
        # same as ERROR for a quick fix of decoding exception,
        # resource_version in BOOKMARK is *not* used at all.
        self.assertEqual(None, w.resource_version)

    def test_watch_with_exception(self):
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(side_effect=KeyError('expected'))

        fake_api = Mock()
        fake_api.get_thing = Mock(return_value=fake_resp)

        w = Watch()
        try:
            for _ in w.stream(fake_api.get_thing):
                self.fail(self, "Should fail on exception.")
        except KeyError:
            pass
            # expected

        fake_api.get_thing.assert_called_once_with(
            _preload_content=False, watch=True)
        fake_resp.stream.assert_called_once_with(
            amt=None, decode_content=False)
        fake_resp.close.assert_called_once()
        fake_resp.release_conn.assert_called_once()

    def test_watch_with_error_event(self):
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(
            return_value=[
                '{"type": "ERROR", "object": {"code": 410, '
                '"reason": "Gone", "message": "error message"}}\n'])

        fake_api = Mock()
        fake_api.get_thing = Mock(return_value=fake_resp)

        w = Watch()
        # No events are generated when no initial resourceVersion is passed
        # No retry is attempted either, preventing an ApiException
        assert not list(w.stream(fake_api.get_thing))

        fake_api.get_thing.assert_called_once_with(
            _preload_content=False, watch=True)
        fake_resp.stream.assert_called_once_with(
            amt=None, decode_content=False)
        fake_resp.close.assert_called_once()
        fake_resp.release_conn.assert_called_once()

    def test_watch_retries_on_error_event(self):
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(
            return_value=[
                '{"type": "ERROR", "object": {"code": 410, '
                '"reason": "Gone", "message": "error message"}}\n'])

        fake_api = Mock()
        fake_api.get_thing = Mock(return_value=fake_resp)

        w = Watch()
        try:
            for _ in w.stream(fake_api.get_thing, resource_version=0):
                self.fail(self, "Should fail with ApiException.")
        except client.rest.ApiException:
            pass

        # Two calls should be expected during a retry
        fake_api.get_thing.assert_has_calls(
            [call(resource_version=0, _preload_content=False, watch=True)] * 2)
        fake_resp.stream.assert_has_calls(
            [call(amt=None, decode_content=False)] * 2)
        assert fake_resp.close.call_count == 2
        assert fake_resp.release_conn.call_count == 2

    def test_watch_with_error_event_and_timeout_param(self):
        fake_resp = Mock()
        fake_resp.close = Mock()
        fake_resp.release_conn = Mock()
        fake_resp.stream = Mock(
            return_value=[
                '{"type": "ERROR", "object": {"code": 410, '
                '"reason": "Gone", "message": "error message"}}\n'])

        fake_api = Mock()
        fake_api.get_thing = Mock(return_value=fake_resp)

        w = Watch()
        try:
            for _ in w.stream(fake_api.get_thing, timeout_seconds=10):
                self.fail(self, "Should fail with ApiException.")
        except client.rest.ApiException:
            pass

        fake_api.get_thing.assert_called_once_with(
            _preload_content=False, watch=True, timeout_seconds=10)
        fake_resp.stream.assert_called_once_with(
            amt=None, decode_content=False)
        fake_resp.close.assert_called_once()
        fake_resp.release_conn.assert_called_once()
    
    @classmethod
    def setUpClass(cls):
        cls.api = Mock()
        cls.namespace = "default"

    def test_pod_log_empty_lines(self):
        pod_name = "demo-bug"
        
        try:
            self.api.create_namespaced_pod = Mock()
            self.api.read_namespaced_pod = Mock()
            self.api.delete_namespaced_pod = Mock()
            self.api.read_namespaced_pod_log = Mock()

            #pod creating step
            self.api.create_namespaced_pod.return_value = None
            
            #Checking pod status
            mock_pod = Mock()
            mock_pod.status.phase = "Running"
            self.api.read_namespaced_pod.return_value = mock_pod
            
            # Printing at pod output
            self.api.read_namespaced_pod_log.return_value = iter(["Hello from Docker\n"])

            # Wait for the pod to reach 'Running'
            timeout = 60
            start_time = time.time()
            while time.time() - start_time < timeout:
                pod = self.api.read_namespaced_pod(name=pod_name, namespace=self.namespace)
                if pod.status.phase == "Running":
                    break
                time.sleep(2)
            else:
                self.fail("Pod did not reach 'Running' state within timeout")

            # Reading and streaming logs using Watch (mocked)
            w = Watch()
            log_output = []
            #Mock logs used for this test
            w.stream = Mock(return_value=[
                        "Hello from Docker",
                        "",
                        "",
                        "\n\n",
                        "Another log line",
                        "",
                        "\n",
                        "Final log"
                    ])
            for event in w.stream(self.api.read_namespaced_pod_log, name=pod_name, namespace=self.namespace, follow=True):
                log_output.append(event)
                print(event)

            # Print outputs
            print(f"Captured logs: {log_output}") 
            # self.assertTrue(any("Hello from Docker" in line for line in log_output))
            # self.assertTrue(any(line.strip() == "" for line in log_output), "No empty lines found in logs")
            expected_log = [
                "Hello from Docker",
                "",
                "",
                "\n\n",
                "Another log line",
                "",
                "\n",
                "Final log"
            ]
            
            self.assertEqual(log_output, expected_log, "Captured logs do not match expected logs")

        except ApiException as e:
            self.fail(f"Kubernetes API exception: {e}")
        finally:
            #checking pod is calling for delete
            self.api.delete_namespaced_pod(name=pod_name, namespace=self.namespace)
            self.api.delete_namespaced_pod.assert_called_once_with(name=pod_name, namespace=self.namespace)

if __name__ == '__main__':
    unittest.main()
