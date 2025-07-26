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
import six
import json
import logging
import hashlib
import tempfile
from functools import partial
from collections import defaultdict
from abc import abstractmethod, abstractproperty

from urllib3.exceptions import ProtocolError, MaxRetryError

from kubernetes import __version__
from .exceptions import NotFoundError, ResourceNotFoundError, ResourceNotUniqueError, ApiException, ServiceUnavailableError
from .resource import Resource, ResourceList


DISCOVERY_PREFIX = 'apis'


class Discoverer(object):
    """
        A convenient container for storing discovered API resources. Allows
        easy searching and retrieval of specific resources.

        Subclasses implement the abstract methods with different loading strategies.
    """

    def __init__(self, client, cache_file):
        self.client = client
        default_cache_id = self.client.configuration.host
        if six.PY3:
            default_cache_id = default_cache_id.encode('utf-8')
        try:
            default_cachefile_name = 'osrcp-{0}.json'.format(hashlib.md5(default_cache_id, usedforsecurity=False).hexdigest())
        except TypeError:
            # usedforsecurity is only supported in 3.9+
            default_cachefile_name = 'osrcp-{0}.json'.format(hashlib.md5(default_cache_id).hexdigest())
        self.__cache_file = cache_file or os.path.join(tempfile.gettempdir(), default_cachefile_name)
        self.__init_cache()

    def __init_cache(self, refresh=False):
        if refresh or not os.path.exists(self.__cache_file):
            self._cache = {'library_version': __version__}
            refresh = True
        else:
            try:
                with open(self.__cache_file, 'r') as f:
                    self._cache = json.load(f, cls=partial(CacheDecoder, self.client))
                if self._cache.get('library_version') != __version__:
                    # Version mismatch, need to refresh cache
                    self.invalidate_cache()
            except Exception as e:
                logging.error("load cache error: %s", e)
                self.invalidate_cache()
        self._load_server_info()
        self.discover()
        if refresh:
            self._write_cache()

    def _write_cache(self):
        try:
            with open(self.__cache_file, 'w') as f:
                json.dump(self._cache, f, cls=CacheEncoder)
        except Exception:
            # Failing to write the cache isn't a big enough error to crash on
            pass

    def invalidate_cache(self):
        self.__init_cache(refresh=True)

    @abstractproperty
    def api_groups(self):
        pass

    @abstractmethod
    def search(self, prefix=None, group=None, api_version=None, kind=None, **kwargs):
        pass

    @abstractmethod
    def discover(self):
        pass

    @property
    def version(self):
        return self.__version

    def default_groups(self, request_resources=False):
        groups = {}
        groups['api'] = { '': {
            'v1': (ResourceGroup( True, resources=self.get_resources_for_api_version('api', '', 'v1', True) )
                if request_resources else ResourceGroup(True))
        }}

        groups[DISCOVERY_PREFIX] = {'': {
            'v1': ResourceGroup(True, resources = {"List": [ResourceList(self.client)]})
        }}
        return groups

    def parse_api_groups(self, request_resources=False, update=False):
        """ Discovers all API groups present in the cluster """
        if not self._cache.get('resources') or update:
            self._cache['resources'] = self._cache.get('resources', {})
            groups_response = self.client.request('GET', '/{}'.format(DISCOVERY_PREFIX)).groups

            groups = self.default_groups(request_resources=request_resources)

            for group in groups_response:
                new_group = {}
                for version_raw in group['versions']:
                    version = version_raw['version']
                    resource_group = self._cache.get('resources', {}).get(DISCOVERY_PREFIX, {}).get(group['name'], {}).get(version)
                    preferred = version_raw == group['preferredVersion']
                    resources = resource_group.resources if resource_group else {}
                    if request_resources:
                        resources = self.get_resources_for_api_version(DISCOVERY_PREFIX, group['name'], version, preferred)
                    new_group[version] = ResourceGroup(preferred, resources=resources)
                groups[DISCOVERY_PREFIX][group['name']] = new_group
            self._cache['resources'].update(groups)
            self._write_cache()

        return self._cache['resources']

    def _load_server_info(self):
        def just_json(_, serialized):
            return serialized

        if not self._cache.get('version'):
            try:
                self._cache['version'] = {
                    'kubernetes': self.client.request('get', '/version', serializer=just_json)
                }
            except (ValueError, MaxRetryError) as e:
                if isinstance(e, MaxRetryError) and not isinstance(e.reason, ProtocolError):
                    raise
                if not self.client.configuration.host.startswith("https://"):
                    raise ValueError("Host value %s should start with https:// when talking to HTTPS endpoint" %
                                     self.client.configuration.host)
                else:
                    raise

        self.__version = self._cache['version']

    def get_resources_for_api_version(self, prefix, group, version, preferred):
        """ returns a dictionary of resources associated with provided (prefix, group, version)"""

        resources = defaultdict(list)
        subresources = {}

        path = '/'.join(filter(None, [prefix, group, version]))
        try:
            resources_response = self.client.request('GET', path).resources or []
        except ServiceUnavailableError:
            resources_response = []

        resources_raw = list(filter(lambda resource: '/' not in resource['name'], resources_response))
        subresources_raw = list(filter(lambda resource: '/' in resource['name'], resources_response))
        for subresource in subresources_raw:
            resource, name = subresource['name'].split('/', 1)
            if not subresources.get(resource):
                subresources[resource] = {}
            subresources[resource][name] = subresource

        for resource in resources_raw:
            # Prevent duplicate keys
            for key in ('prefix', 'group', 'api_version', 'client', 'preferred'):
                resource.pop(key, None)

            resourceobj = Resource(
                prefix=prefix,
                group=group,
                api_version=version,
                client=self.client,
                preferred=preferred,
                subresources=subresources.get(resource['name']),
                **resource
            )
            resources[resource['kind']].append(resourceobj)

            resource_list = ResourceList(self.client, group=group, api_version=version, base_kind=resource['kind'])
            resources[resource_list.kind].append(resource_list)
        return resources

    def get(self, **kwargs):
        """ Same as search, but will throw an error if there are multiple or no
            results. If there are multiple results and only one is an exact match
            on api_version, that resource will be returned.
        """
        results = self.search(**kwargs)
        # If there are multiple matches, prefer exact matches on api_version
        if len(results) > 1 and kwargs.get('api_version'):
            results = [
                result for result in results if result.group_version == kwargs['api_version']
            ]
        # If there are multiple matches, prefer non-List kinds
        if len(results) > 1 and not all([isinstance(x, ResourceList) for x in results]):
            results = [result for result in results if not isinstance(result, ResourceList)]
        if len(results) == 1:
            return results[0]
        elif not results:
            raise ResourceNotFoundError('No matches found for {}'.format(kwargs))
        else:
            raise ResourceNotUniqueError('Multiple matches found for {}: {}'.format(kwargs, results))


class LazyDiscoverer(Discoverer):
    """ A convenient container for storing discovered API resources. Allows
        easy searching and retrieval of specific resources.

        Resources for the cluster are loaded lazily.
    """

    def __init__(self, client, cache_file):
        Discoverer.__init__(self, client, cache_file)
        self.__update_cache = False

    def discover(self):
        self.__resources = self.parse_api_groups(request_resources=False)

    def __maybe_write_cache(self):
        if self.__update_cache:
            self._write_cache()
            self.__update_cache = False

    @property
    def api_groups(self):
        return self.parse_api_groups(request_resources=False, update=True)['apis'].keys()

    def search(self, **kwargs):
        # In first call, ignore ResourceNotFoundError and set default value for results
        try:
            results = self.__search(self.__build_search(**kwargs), self.__resources, [])
        except ResourceNotFoundError:
            results = []
        if not results:
            self.invalidate_cache()
            results = self.__search(self.__build_search(**kwargs), self.__resources, [])
        self.__maybe_write_cache()
        return results

    def __search(self,  parts, resources, reqParams):
        part = parts[0]
        if part != '*':

            resourcePart = resources.get(part)
            if not resourcePart:
                return []
            elif isinstance(resourcePart, ResourceGroup):
                if len(reqParams) != 2:
                    raise ValueError("prefix and group params should be present, have %s" % reqParams)
                # Check if we've requested resources for this group
                if not resourcePart.resources:
                    prefix, group, version = reqParams[0], reqParams[1], part
                    try:
                        resourcePart.resources = self.get_resources_for_api_version(
                            prefix, group, part, resourcePart.preferred)
                    except NotFoundError:
                        raise ResourceNotFoundError

                    self._cache['resources'][prefix][group][version] = resourcePart
                    self.__update_cache = True
                return self.__search(parts[1:], resourcePart.resources, reqParams)
            elif isinstance(resourcePart, dict):
                # In this case parts [0] will be a specified prefix, group, version
                # as we recurse
                return self.__search(parts[1:], resourcePart, reqParams + [part] )
            else:
                if parts[1] != '*' and isinstance(parts[1], dict):
                    for _resource in resourcePart:
                        for term, value in parts[1].items():
                            if getattr(_resource, term) == value:
                                return [_resource]

                    return []
                else:
                    return resourcePart
        else:
            matches = []
            for key in resources.keys():
                matches.extend(self.__search([key] + parts[1:], resources, reqParams))
            return matches

    def __build_search(self, prefix=None, group=None, api_version=None, kind=None, **kwargs):
        if not group and api_version and '/' in api_version:
            group, api_version = api_version.split('/')

        items = [prefix, group, api_version, kind, kwargs]
        return list(map(lambda x: x or '*', items))

    def __iter__(self):
        for prefix, groups in self.__resources.items():
            for group, versions in groups.items():
                for version, rg in versions.items():
                    # Request resources for this groupVersion if we haven't yet
                    if not rg.resources:
                        rg.resources = self.get_resources_for_api_version(
                            prefix, group, version, rg.preferred)
                        self._cache['resources'][prefix][group][version] = rg
                        self.__update_cache = True
                    for _, resource in six.iteritems(rg.resources):
                        yield resource
        self.__maybe_write_cache()


class EagerDiscoverer(Discoverer):
    """ A convenient container for storing discovered API resources. Allows
        easy searching and retrieval of specific resources.

        All resources are discovered for the cluster upon object instantiation.
    """

    def update(self, resources):
        self.__resources = resources

    def __init__(self, client, cache_file):
        Discoverer.__init__(self, client, cache_file)

    def discover(self):
        self.__resources = self.parse_api_groups(request_resources=True)

    @property
    def api_groups(self):
        """ list available api groups """
        return self.parse_api_groups(request_resources=True, update=True)['apis'].keys()


    def search(self, **kwargs):
        """ Takes keyword arguments and returns matching resources. The search
            will happen in the following order:
                prefix: The api prefix for a resource, ie, /api, /oapi, /apis. Can usually be ignored
                group: The api group of a resource. Will also be extracted from api_version if it is present there
                api_version: The api version of a resource
                kind: The kind of the resource
                arbitrary arguments (see below), in random order

            The arbitrary arguments can be any valid attribute for an Resource object
        """
        results = self.__search(self.__build_search(**kwargs), self.__resources)
        if not results:
            self.invalidate_cache()
            results = self.__search(self.__build_search(**kwargs), self.__resources)
        return results

    def __build_search(self, prefix=None, group=None, api_version=None, kind=None, **kwargs):
        if not group and api_version and '/' in api_version:
            group, api_version = api_version.split('/')

        items = [prefix, group, api_version, kind, kwargs]
        return list(map(lambda x: x or '*', items))

    def __search(self, parts, resources):
        part = parts[0]
        resourcePart = resources.get(part)

        if part != '*' and resourcePart:
            if isinstance(resourcePart, ResourceGroup):
                return self.__search(parts[1:], resourcePart.resources)
            elif isinstance(resourcePart, dict):
                return self.__search(parts[1:], resourcePart)
            else:
                if parts[1] != '*' and isinstance(parts[1], dict):
                    for _resource in resourcePart:
                        for term, value in parts[1].items():
                            if getattr(_resource, term) == value:
                                return [_resource]
                    return []
                else:
                    return resourcePart
        elif part == '*':
            matches = []
            for key in resources.keys():
                matches.extend(self.__search([key] + parts[1:], resources))
            return matches
        return []

    def __iter__(self):
        for _, groups in self.__resources.items():
            for _, versions in groups.items():
                for _, resources in versions.items():
                    for _, resource in resources.items():
                        yield resource


class ResourceGroup(object):
    """Helper class for Discoverer container"""
    def __init__(self, preferred, resources=None):
        self.preferred = preferred
        self.resources = resources or {}

    def to_dict(self):
        return {
            '_type': 'ResourceGroup',
            'preferred': self.preferred,
            'resources': self.resources,
        }


class CacheEncoder(json.JSONEncoder):

    def default(self, o):
        return o.to_dict()


class CacheDecoder(json.JSONDecoder):
    def __init__(self, client, *args, **kwargs):
        self.client = client
        json.JSONDecoder.__init__(self, object_hook=self.object_hook, *args, **kwargs)

    def object_hook(self, obj):
        if '_type' not in obj:
            return obj
        _type = obj.pop('_type')
        if _type == 'Resource':
            return Resource(client=self.client, **obj)
        elif _type == 'ResourceList':
            return ResourceList(self.client, **obj)
        elif _type == 'ResourceGroup':
            return ResourceGroup(obj['preferred'], resources=self.object_hook(obj['resources']))
        return obj
