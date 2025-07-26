# Copyright 2019 The Kubernetes Authors.
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

import time
import unittest
import uuid

from kubernetes.e2e_test import base
from kubernetes.client import api_client

from . import DynamicClient
from .resource import ResourceInstance, ResourceField
from .exceptions import ResourceNotFoundError


def short_uuid():
    id = str(uuid.uuid4())
    return id[-12:]


class TestDynamicClient(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.config = base.get_e2e_configuration()

    def test_cluster_custom_resources(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))

        with self.assertRaises(ResourceNotFoundError):
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ClusterChangeMe')

        crd_api = client.resources.get(
            api_version='apiextensions.k8s.io/v1beta1',
            kind='CustomResourceDefinition')
        name = 'clusterchangemes.apps.example.com'
        crd_manifest = {
            'apiVersion': 'apiextensions.k8s.io/v1beta1',
            'kind': 'CustomResourceDefinition',
            'metadata': {
                'name': name,
            },
            'spec': {
                'group': 'apps.example.com',
                'names': {
                    'kind': 'ClusterChangeMe',
                    'listKind': 'ClusterChangeMeList',
                    'plural': 'clusterchangemes',
                    'singular': 'clusterchangeme',
                },
                'scope': 'Cluster',
                'version': 'v1',
                'subresources': {
                    'status': {}
                }
            }
        }
        resp = crd_api.create(crd_manifest)

        self.assertEqual(name, resp.metadata.name)
        self.assertTrue(resp.status)

        resp = crd_api.get(
            name=name,
        )
        self.assertEqual(name, resp.metadata.name)
        self.assertTrue(resp.status)

        try:
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ClusterChangeMe')
        except ResourceNotFoundError:
            # Need to wait a sec for the discovery layer to get updated
            time.sleep(2)
        changeme_api = client.resources.get(
            api_version='apps.example.com/v1', kind='ClusterChangeMe')
        resp = changeme_api.get()
        self.assertEqual(resp.items, [])
        changeme_name = 'custom-resource' + short_uuid()
        changeme_manifest = {
            'apiVersion': 'apps.example.com/v1',
            'kind': 'ClusterChangeMe',
            'metadata': {
                'name': changeme_name,
            },
            'spec': {}
        }

        resp = changeme_api.create(body=changeme_manifest)
        self.assertEqual(resp.metadata.name, changeme_name)

        resp = changeme_api.get(name=changeme_name)
        self.assertEqual(resp.metadata.name, changeme_name)

        changeme_manifest['spec']['size'] = 3
        resp = changeme_api.patch(
            body=changeme_manifest,
            content_type='application/merge-patch+json'
        )
        self.assertEqual(resp.spec.size, 3)

        resp = changeme_api.get(name=changeme_name)
        self.assertEqual(resp.spec.size, 3)

        resp = changeme_api.get()
        self.assertEqual(len(resp.items), 1)

        resp = changeme_api.delete(
            name=changeme_name,
        )

        resp = changeme_api.get()
        self.assertEqual(len(resp.items), 0)

        resp = crd_api.delete(
            name=name,
        )

        time.sleep(2)
        client.resources.invalidate_cache()
        with self.assertRaises(ResourceNotFoundError):
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ClusterChangeMe')

    def test_async_namespaced_custom_resources(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))

        with self.assertRaises(ResourceNotFoundError):
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ChangeMe')

        crd_api = client.resources.get(
            api_version='apiextensions.k8s.io/v1beta1',
            kind='CustomResourceDefinition')

        name = 'changemes.apps.example.com'

        crd_manifest = {
            'apiVersion': 'apiextensions.k8s.io/v1beta1',
            'kind': 'CustomResourceDefinition',
            'metadata': {
                'name': name,
            },
            'spec': {
                'group': 'apps.example.com',
                'names': {
                    'kind': 'ChangeMe',
                    'listKind': 'ChangeMeList',
                    'plural': 'changemes',
                    'singular': 'changeme',
                },
                'scope': 'Namespaced',
                'version': 'v1',
                'subresources': {
                    'status': {}
                }
            }
        }
        async_resp = crd_api.create(crd_manifest, async_req=True)

        self.assertEqual(name, async_resp.metadata.name)
        self.assertTrue(async_resp.status)

        async_resp = crd_api.get(
            name=name,
            async_req=True
        )
        self.assertEqual(name, async_resp.metadata.name)
        self.assertTrue(async_resp.status)

        try:
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ChangeMe')
        except ResourceNotFoundError:
            # Need to wait a sec for the discovery layer to get updated
            time.sleep(2)
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ChangeMe')

        async_resp = changeme_api.get(async_req=True)
        self.assertEqual(async_resp.items, [])

        changeme_name = 'custom-resource' + short_uuid()
        changeme_manifest = {
            'apiVersion': 'apps.example.com/v1',
            'kind': 'ChangeMe',
            'metadata': {
                'name': changeme_name,
            },
            'spec': {}
        }

        async_resp = changeme_api.create(body=changeme_manifest, namespace='default', async_req=True)
        self.assertEqual(async_resp.metadata.name, changeme_name)

        async_resp = changeme_api.get(name=changeme_name, namespace='default', async_req=True)
        self.assertEqual(async_resp.metadata.name, changeme_name)

        changeme_manifest['spec']['size'] = 3
        async_resp = changeme_api.patch(
            body=changeme_manifest,
            namespace='default',
            content_type='application/merge-patch+json',
            async_req=True
        )
        self.assertEqual(async_resp.spec.size, 3)

        async_resp = changeme_api.get(name=changeme_name, namespace='default', async_req=True)
        self.assertEqual(async_resp.spec.size, 3)

        async_resp = changeme_api.get(namespace='default', async_req=True)
        self.assertEqual(len(async_resp.items), 1)

        async_resp = changeme_api.get(async_req=True)
        self.assertEqual(len(async_resp.items), 1)

        async_resp = changeme_api.delete(
            name=changeme_name,
            namespace='default',
            async_req=True
        )

        async_resp = changeme_api.get(namespace='default', async_req=True)
        self.assertEqual(len(async_resp.items), 0)

        async_resp = changeme_api.get(async_req=True)
        self.assertEqual(len(async_resp.items), 0)

        async_resp = crd_api.delete(
            name=name,
            async_req=True
        )

        time.sleep(2)
        client.resources.invalidate_cache()
        with self.assertRaises(ResourceNotFoundError):
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ChangeMe')

    def test_namespaced_custom_resources(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))

        with self.assertRaises(ResourceNotFoundError):
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ChangeMe')

        crd_api = client.resources.get(
            api_version='apiextensions.k8s.io/v1beta1',
            kind='CustomResourceDefinition')
        name = 'changemes.apps.example.com'
        crd_manifest = {
            'apiVersion': 'apiextensions.k8s.io/v1beta1',
            'kind': 'CustomResourceDefinition',
            'metadata': {
                'name': name,
            },
            'spec': {
                'group': 'apps.example.com',
                'names': {
                    'kind': 'ChangeMe',
                    'listKind': 'ChangeMeList',
                    'plural': 'changemes',
                    'singular': 'changeme',
                },
                'scope': 'Namespaced',
                'version': 'v1',
                'subresources': {
                    'status': {}
                }
            }
        }
        resp = crd_api.create(crd_manifest)

        self.assertEqual(name, resp.metadata.name)
        self.assertTrue(resp.status)

        resp = crd_api.get(
            name=name,
        )
        self.assertEqual(name, resp.metadata.name)
        self.assertTrue(resp.status)

        try:
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ChangeMe')
        except ResourceNotFoundError:
            # Need to wait a sec for the discovery layer to get updated
            time.sleep(2)
        changeme_api = client.resources.get(
            api_version='apps.example.com/v1', kind='ChangeMe')
        resp = changeme_api.get()
        self.assertEqual(resp.items, [])
        changeme_name = 'custom-resource' + short_uuid()
        changeme_manifest = {
            'apiVersion': 'apps.example.com/v1',
            'kind': 'ChangeMe',
            'metadata': {
                'name': changeme_name,
            },
            'spec': {}
        }

        resp = changeme_api.create(body=changeme_manifest, namespace='default')
        self.assertEqual(resp.metadata.name, changeme_name)

        resp = changeme_api.get(name=changeme_name, namespace='default')
        self.assertEqual(resp.metadata.name, changeme_name)

        changeme_manifest['spec']['size'] = 3
        resp = changeme_api.patch(
            body=changeme_manifest,
            namespace='default',
            content_type='application/merge-patch+json'
        )
        self.assertEqual(resp.spec.size, 3)

        resp = changeme_api.get(name=changeme_name, namespace='default')
        self.assertEqual(resp.spec.size, 3)

        resp = changeme_api.get(namespace='default')
        self.assertEqual(len(resp.items), 1)

        resp = changeme_api.get()
        self.assertEqual(len(resp.items), 1)

        resp = changeme_api.delete(
            name=changeme_name,
            namespace='default'
        )

        resp = changeme_api.get(namespace='default')
        self.assertEqual(len(resp.items), 0)

        resp = changeme_api.get()
        self.assertEqual(len(resp.items), 0)

        resp = crd_api.delete(
            name=name,
        )

        time.sleep(2)
        client.resources.invalidate_cache()
        with self.assertRaises(ResourceNotFoundError):
            changeme_api = client.resources.get(
                api_version='apps.example.com/v1', kind='ChangeMe')

    def test_service_apis(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        api = client.resources.get(api_version='v1', kind='Service')

        name = 'frontend-' + short_uuid()
        service_manifest = {'apiVersion': 'v1',
                            'kind': 'Service',
                            'metadata': {'labels': {'name': name},
                                         'name': name,
                                         'resourceversion': 'v1'},
                            'spec': {'ports': [{'name': 'port',
                                                'port': 80,
                                                'protocol': 'TCP',
                                                'targetPort': 80}],
                                     'selector': {'name': name}}}

        resp = api.create(
            body=service_manifest,
            namespace='default'
        )
        self.assertEqual(name, resp.metadata.name)
        self.assertTrue(resp.status)

        resp = api.get(
            name=name,
            namespace='default'
        )
        self.assertEqual(name, resp.metadata.name)
        self.assertTrue(resp.status)

        service_manifest['spec']['ports'] = [{'name': 'new',
                                              'port': 8080,
                                              'protocol': 'TCP',
                                              'targetPort': 8080}]
        resp = api.patch(
            body=service_manifest,
            name=name,
            namespace='default'
        )
        self.assertEqual(2, len(resp.spec.ports))
        self.assertTrue(resp.status)

        resp = api.delete(
            name=name, body={},
            namespace='default'
        )

    def test_replication_controller_apis(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        api = client.resources.get(
            api_version='v1', kind='ReplicationController')

        name = 'frontend-' + short_uuid()
        rc_manifest = {
            'apiVersion': 'v1',
            'kind': 'ReplicationController',
            'metadata': {'labels': {'name': name},
                         'name': name},
            'spec': {'replicas': 2,
                     'selector': {'name': name},
                     'template': {'metadata': {
                         'labels': {'name': name}},
                         'spec': {'containers': [{
                             'image': 'nginx',
                             'name': 'nginx',
                             'ports': [{'containerPort': 80,
                                        'protocol': 'TCP'}]}]}}}}

        resp = api.create(
            body=rc_manifest, namespace='default')
        self.assertEqual(name, resp.metadata.name)
        self.assertEqual(2, resp.spec.replicas)

        resp = api.get(
            name=name, namespace='default')
        self.assertEqual(name, resp.metadata.name)
        self.assertEqual(2, resp.spec.replicas)

        api.delete(
            name=name,
            namespace='default',
            propagation_policy='Background')

    def test_configmap_apis(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        api = client.resources.get(api_version='v1', kind='ConfigMap')

        name = 'test-configmap-' + short_uuid()
        test_configmap = {
            "kind": "ConfigMap",
            "apiVersion": "v1",
            "metadata": {
                "name": name,
                "labels": {
                    "e2e-test": "true",
                },
            },
            "data": {
                "config.json": "{\"command\":\"/usr/bin/mysqld_safe\"}",
                "frontend.cnf": "[mysqld]\nbind-address = 10.0.0.3\n"
            }
        }

        resp = api.create(
            body=test_configmap, namespace='default'
        )
        self.assertEqual(name, resp.metadata.name)

        resp = api.get(
            name=name, namespace='default', label_selector="e2e-test=true")
        self.assertEqual(name, resp.metadata.name)

        count = 0
        for _ in client.watch(api, timeout=10, namespace="default", name=name):
            count += 1
        self.assertTrue(count > 0, msg="no events received for watch")

        test_configmap['data']['config.json'] = "{}"
        resp = api.patch(
            name=name, namespace='default', body=test_configmap)

        resp = api.delete(
            name=name, body={}, namespace='default')

        resp = api.get(
            namespace='default',
            pretty=True,
            label_selector="e2e-test=true")
        self.assertEqual([], resp.items)

    def test_node_apis(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        api = client.resources.get(api_version='v1', kind='Node')

        for item in api.get().items:
            node = api.get(name=item.metadata.name)
            self.assertTrue(len(dict(node.metadata.labels)) > 0)

    # test_node_apis_partial_object_metadata lists all nodes in the cluster,
    # but only retrieves object metadata
    def test_node_apis_partial_object_metadata(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        api = client.resources.get(api_version='v1', kind='Node')

        params = {
            'header_params': {
                'Accept': 'application/json;as=PartialObjectMetadataList;v=v1;g=meta.k8s.io'}}
        resp = api.get(**params)
        self.assertEqual('PartialObjectMetadataList', resp.kind)
        self.assertEqual('meta.k8s.io/v1', resp.apiVersion)

        params = {
            'header_params': {
                'aCcePt': 'application/json;as=PartialObjectMetadataList;v=v1;g=meta.k8s.io'}}
        resp = api.get(**params)
        self.assertEqual('PartialObjectMetadataList', resp.kind)
        self.assertEqual('meta.k8s.io/v1', resp.apiVersion)

    def test_server_side_apply_api(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        api = client.resources.get(
            api_version='v1', kind='Pod')

        name = 'pod-' + short_uuid()
        pod_manifest = {
                'apiVersion': 'v1',
                'kind': 'Pod',
                'metadata': {'labels': {'name': name},
                            'name': name},
                'spec': {'containers': [{
                            'image': 'nginx',
                            'name': 'nginx',
                            'ports': [{'containerPort': 80,
                                            'protocol': 'TCP'}]}]}}

        resp = api.server_side_apply(
            namespace='default', body=pod_manifest,
            field_manager='kubernetes-unittests', dry_run="All")
        self.assertEqual('kubernetes-unittests', resp.metadata.managedFields[0].manager)


class TestDynamicClientSerialization(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        config = base.get_e2e_configuration()
        cls.client = DynamicClient(api_client.ApiClient(configuration=config))
        cls.pod_manifest = {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {'name': 'foo-pod'},
            'spec': {'containers': [{'name': "main", 'image': "busybox"}]},
        }

    def test_dict_type(self):
        self.assertEqual(self.client.serialize_body(self.pod_manifest), self.pod_manifest)

    def test_resource_instance_type(self):
        inst = ResourceInstance(self.client, self.pod_manifest)
        self.assertEqual(self.client.serialize_body(inst), self.pod_manifest)

    def test_resource_field(self):
        """`ResourceField` is a special type which overwrites `__getattr__` method to return `None`
        when a non-existent attribute was accessed. which means it can pass any `hasattr(...)` tests.
        """
        params = {
            "foo": "bar",
            "self": True
        }
        res = ResourceField(params=params)
        self.assertEqual(res["foo"], params["foo"])
        self.assertEqual(res["self"], params["self"])
        self.assertEqual(self.client.serialize_body(res), params)
