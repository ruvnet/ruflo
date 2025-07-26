# Copyright 2021 The Kubernetes Authors.
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


from . import leaderelection
from .leaderelectionrecord import LeaderElectionRecord
from kubernetes.client.rest import ApiException
from . import electionconfig
import unittest
import threading
import json
import time
import pytest

thread_lock = threading.RLock()

class LeaderElectionTest(unittest.TestCase):
    def test_simple_leader_election(self):
        election_history = []
        leadership_history = []

        def on_create():
            election_history.append("create record")
            leadership_history.append("get leadership")

        def on_update():
            election_history.append("update record")

        def on_change():
            election_history.append("change record")

        mock_lock = MockResourceLock("mock", "mock_namespace", "mock", thread_lock, on_create, on_update, on_change, None)

        def on_started_leading():
            leadership_history.append("start leading")

        def on_stopped_leading():
            leadership_history.append("stop leading")

        # Create config 4.5 4 3
        config = electionconfig.Config(lock=mock_lock, lease_duration=2.5,
                                       renew_deadline=2, retry_period=1.5, onstarted_leading=on_started_leading,
                                       onstopped_leading=on_stopped_leading)

        # Enter leader election
        leaderelection.LeaderElection(config).run()

        self.assert_history(election_history, ["create record", "update record", "update record", "update record"])
        self.assert_history(leadership_history, ["get leadership", "start leading", "stop leading"])

    def test_leader_election(self):
        election_history = []
        leadership_history = []

        def on_create_A():
            election_history.append("A creates record")
            leadership_history.append("A gets leadership")

        def on_update_A():
            election_history.append("A updates record")

        def on_change_A():
            election_history.append("A gets leadership")

        mock_lock_A = MockResourceLock("mock", "mock_namespace", "MockA", thread_lock, on_create_A, on_update_A, on_change_A, None)
        mock_lock_A.renew_count_max = 3

        def on_started_leading_A():
            leadership_history.append("A starts leading")

        def on_stopped_leading_A():
            leadership_history.append("A stops leading")

        config_A = electionconfig.Config(lock=mock_lock_A, lease_duration=2.5,
                                         renew_deadline=2, retry_period=1.5, onstarted_leading=on_started_leading_A,
                                         onstopped_leading=on_stopped_leading_A)

        def on_create_B():
            election_history.append("B creates record")
            leadership_history.append("B gets leadership")

        def on_update_B():
            election_history.append("B updates record")

        def on_change_B():
            leadership_history.append("B gets leadership")

        mock_lock_B = MockResourceLock("mock", "mock_namespace", "MockB", thread_lock, on_create_B, on_update_B, on_change_B, None)
        mock_lock_B.renew_count_max = 4

        def on_started_leading_B():
            leadership_history.append("B starts leading")

        def on_stopped_leading_B():
            leadership_history.append("B stops leading")

        config_B = electionconfig.Config(lock=mock_lock_B, lease_duration=2.5,
                                         renew_deadline=2, retry_period=1.5, onstarted_leading=on_started_leading_B,
                                         onstopped_leading=on_stopped_leading_B)

        mock_lock_B.leader_record = mock_lock_A.leader_record

        threading.daemon = True
        # Enter leader election for A
        threading.Thread(target=leaderelection.LeaderElection(config_A).run()).start()

        # Enter leader election for B
        threading.Thread(target=leaderelection.LeaderElection(config_B).run()).start()

        time.sleep(5)

        self.assert_history(election_history,
                            ["A creates record",
                             "A updates record",
                             "A updates record",
                             "B updates record",
                             "B updates record",
                             "B updates record",
                             "B updates record"])
        self.assert_history(leadership_history,
                            ["A gets leadership",
                             "A starts leading",
                             "A stops leading",
                             "B gets leadership",
                             "B starts leading",
                             "B stops leading"])


    """Expected behavior: to check if the leader stops leading if it fails to update the lock within the renew_deadline
    and stops leading after finally timing out. The difference between each try comes out to be approximately the sleep
    time.
    Example:
    create record:  0s
    on try update:  1.5s
    on update:  zzz s
    on try update:  3s
    on update: zzz s 
    on try update:  4.5s
    on try update:  6s
    Timeout - Leader Exits"""
    def test_Leader_election_with_renew_deadline(self):
        election_history = []
        leadership_history = []

        def on_create():
            election_history.append("create record")
            leadership_history.append("get leadership")

        def on_update():
            election_history.append("update record")

        def on_change():
            election_history.append("change record")

        def on_try_update():
            election_history.append("try update record")

        mock_lock = MockResourceLock("mock", "mock_namespace", "mock", thread_lock, on_create, on_update, on_change, on_try_update)
        mock_lock.renew_count_max = 3

        def on_started_leading():
            leadership_history.append("start leading")

        def on_stopped_leading():
            leadership_history.append("stop leading")

        # Create config
        config = electionconfig.Config(lock=mock_lock, lease_duration=2.5,
                                       renew_deadline=2, retry_period=1.5, onstarted_leading=on_started_leading,
                                       onstopped_leading=on_stopped_leading)

        # Enter leader election
        leaderelection.LeaderElection(config).run()

        self.assert_history(election_history,
                            ["create record",
                             "try update record",
                             "update record",
                             "try update record",
                             "update record",
                             "try update record",
                             "try update record"])

        self.assert_history(leadership_history, ["get leadership", "start leading", "stop leading"])

    def assert_history(self, history, expected):
        self.assertIsNotNone(expected)
        self.assertIsNotNone(history)
        self.assertEqual(len(expected), len(history))

        for idx in range(len(history)):
            self.assertEqual(history[idx], expected[idx],
                              msg="Not equal at index {}, expected {}, got {}".format(idx, expected[idx],
                                                                                      history[idx]))


class MockResourceLock:
    def __init__(self, name, namespace, identity, shared_lock, on_create=None, on_update=None, on_change=None, on_try_update=None):
        # self.leader_record is shared between two MockResourceLock objects
        self.leader_record = []
        self.renew_count = 0
        self.renew_count_max = 4
        self.name = name
        self.namespace = namespace
        self.identity = str(identity)
        self.lock = shared_lock

        self.on_create = on_create
        self.on_update = on_update
        self.on_change = on_change
        self.on_try_update = on_try_update

    def get(self, name, namespace):
        self.lock.acquire()
        try:
            if self.leader_record:
                return True, self.leader_record[0]

            ApiException.body = json.dumps({'code': 404})
            return False, ApiException
        finally:
            self.lock.release()

    def create(self, name, namespace, election_record):
        self.lock.acquire()
        try:
            if len(self.leader_record) == 1:
                return False
            self.leader_record.append(election_record)
            self.on_create()
            self.renew_count += 1
            return True
        finally:
            self.lock.release()

    def update(self, name, namespace, updated_record):
        self.lock.acquire()
        try:
            if self.on_try_update:
                self.on_try_update()
            if self.renew_count >= self.renew_count_max:
                return False

            old_record = self.leader_record[0]
            self.leader_record[0] = updated_record

            self.on_update()

            if old_record.holder_identity != updated_record.holder_identity:
                self.on_change()

            self.renew_count += 1
            return True
        finally:
            self.lock.release()


if __name__ == '__main__':
    unittest.main()
