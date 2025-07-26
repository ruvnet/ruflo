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

import uuid
from kubernetes import client, config
from kubernetes.leaderelection import leaderelection
from kubernetes.leaderelection.resourcelock.configmaplock import ConfigMapLock
from kubernetes.leaderelection import electionconfig


# Authenticate using config file
config.load_kube_config(config_file=r"")

# Parameters required from the user

# A unique identifier for this candidate
candidate_id = uuid.uuid4()

# Name of the lock object to be created
lock_name = "examplepython"

# Kubernetes namespace
lock_namespace = "default"


# The function that a user wants to run once a candidate is elected as a leader
def example_func():
    print("I am leader")


# A user can choose not to provide any callbacks for what to do when a candidate fails to lead - onStoppedLeading()
# In that case, a default callback function will be used

# Create config
config = electionconfig.Config(ConfigMapLock(lock_name, lock_namespace, candidate_id), lease_duration=17,
                               renew_deadline=15, retry_period=5, onstarted_leading=example_func,
                               onstopped_leading=None)

# Enter leader election
leaderelection.LeaderElection(config).run()

# User can choose to do another round of election or simply exit
print("Exited leader election")
