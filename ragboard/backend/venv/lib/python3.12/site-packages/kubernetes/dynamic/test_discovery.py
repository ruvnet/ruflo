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

import os
import unittest

from kubernetes.e2e_test import base
from kubernetes.client import api_client

from . import DynamicClient


class TestDiscoverer(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.config = base.get_e2e_configuration()

    def test_init_cache_from_file(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        client.resources.get(api_version='v1', kind='Node')
        mtime1 = os.path.getmtime(client.resources._Discoverer__cache_file)

        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        client.resources.get(api_version='v1', kind='Node')
        mtime2 = os.path.getmtime(client.resources._Discoverer__cache_file)

        # test no Discoverer._write_cache called
        self.assertTrue(mtime1 == mtime2)

    def test_cache_decoder_resource_and_subresource(self):
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        # first invalidate cache
        client.resources.invalidate_cache()

        # do Discoverer.__init__
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        # the resources of client will use _cache['resources'] in memory
        deploy1 = client.resources.get(kind='Deployment')

        # do Discoverer.__init__
        client = DynamicClient(api_client.ApiClient(configuration=self.config))
        # the resources of client will use _cache['resources'] decode from cache file
        deploy2 = client.resources.get(kind='Deployment')

        # test Resource is the same
        self.assertTrue(deploy1 == deploy2)

        # test Subresource is the same
        self.assertTrue(deploy1.status == deploy2.status)
