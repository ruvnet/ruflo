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

from kubernetes.client.rest import ApiException
from kubernetes import client, config
from kubernetes.client.api_client import ApiClient
from ..leaderelectionrecord import LeaderElectionRecord
import json
import logging
logging.basicConfig(level=logging.INFO)


class ConfigMapLock:
    def __init__(self, name, namespace, identity):
        """
        :param name: name of the lock
        :param namespace: namespace
        :param identity: A unique identifier that the candidate is using
        """
        self.api_instance = client.CoreV1Api()
        self.leader_electionrecord_annotationkey = 'control-plane.alpha.kubernetes.io/leader'
        self.name = name
        self.namespace = namespace
        self.identity = str(identity)
        self.configmap_reference = None
        self.lock_record = {
            'holderIdentity': None,
            'leaseDurationSeconds': None,
            'acquireTime': None,
            'renewTime': None
                            }

    # get returns the election record from a ConfigMap Annotation
    def get(self, name, namespace):
        """
        :param name: Name of the configmap object information to get
        :param namespace: Namespace in which the configmap object is to be searched
        :return: 'True, election record' if object found else 'False, exception response'
        """
        try:
            api_response = self.api_instance.read_namespaced_config_map(name, namespace)

            # If an annotation does not exist - add the leader_electionrecord_annotationkey
            annotations = api_response.metadata.annotations
            if annotations is None or annotations == '':
                api_response.metadata.annotations = {self.leader_electionrecord_annotationkey: ''}
                self.configmap_reference = api_response
                return True, None

            # If an annotation exists but, the leader_electionrecord_annotationkey does not then add it as a key
            if not annotations.get(self.leader_electionrecord_annotationkey):
                api_response.metadata.annotations = {self.leader_electionrecord_annotationkey: ''}
                self.configmap_reference = api_response
                return True, None

            lock_record = self.get_lock_object(json.loads(annotations[self.leader_electionrecord_annotationkey]))

            self.configmap_reference = api_response
            return True, lock_record
        except ApiException as e:
            return False, e

    def create(self, name, namespace, election_record):
        """
        :param electionRecord: Annotation string
        :param name: Name of the configmap object to be created
        :param namespace: Namespace in which the configmap object is to be created
        :return: 'True' if object is created else 'False' if failed
        """
        body = client.V1ConfigMap(
            metadata={"name": name,
                      "annotations": {self.leader_electionrecord_annotationkey: json.dumps(self.get_lock_dict(election_record))}})

        try:
            api_response = self.api_instance.create_namespaced_config_map(namespace, body, pretty=True)
            return True
        except ApiException as e:
            logging.info("Failed to create lock as {}".format(e))
            return False

    def update(self, name, namespace, updated_record):
        """
        :param name: name of the lock to be updated
        :param namespace: namespace the lock is in
        :param updated_record: the updated election record
        :return: True if update is successful False if it fails
        """
        try:
            # Set the updated record
            self.configmap_reference.metadata.annotations[self.leader_electionrecord_annotationkey] = json.dumps(self.get_lock_dict(updated_record))
            api_response = self.api_instance.replace_namespaced_config_map(name=name, namespace=namespace,
                                                                           body=self.configmap_reference)
            return True
        except ApiException as e:
            logging.info("Failed to update lock as {}".format(e))
            return False

    def get_lock_object(self, lock_record):
        leader_election_record = LeaderElectionRecord(None, None, None, None)

        if lock_record.get('holderIdentity'):
            leader_election_record.holder_identity = lock_record['holderIdentity']
        if lock_record.get('leaseDurationSeconds'):
            leader_election_record.lease_duration = lock_record['leaseDurationSeconds']
        if lock_record.get('acquireTime'):
            leader_election_record.acquire_time = lock_record['acquireTime']
        if lock_record.get('renewTime'):
            leader_election_record.renew_time = lock_record['renewTime']

        return leader_election_record

    def get_lock_dict(self, leader_election_record):
        self.lock_record['holderIdentity'] = leader_election_record.holder_identity
        self.lock_record['leaseDurationSeconds'] = leader_election_record.lease_duration
        self.lock_record['acquireTime'] = leader_election_record.acquire_time
        self.lock_record['renewTime'] = leader_election_record.renew_time
        
        return self.lock_record