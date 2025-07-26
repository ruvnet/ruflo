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

import six
import json

from kubernetes import watch
from kubernetes.client.rest import ApiException

from .discovery import EagerDiscoverer, LazyDiscoverer
from .exceptions import api_exception, KubernetesValidateMissing
from .resource import Resource, ResourceList, Subresource, ResourceInstance, ResourceField

try:
    import kubernetes_validate
    HAS_KUBERNETES_VALIDATE = True
except ImportError:
    HAS_KUBERNETES_VALIDATE = False

try:
    from kubernetes_validate.utils import VersionNotSupportedError
except ImportError:
    class VersionNotSupportedError(NotImplementedError):
        pass

__all__ = [
    'DynamicClient',
    'ResourceInstance',
    'Resource',
    'ResourceList',
    'Subresource',
    'EagerDiscoverer',
    'LazyDiscoverer',
    'ResourceField',
]


def meta_request(func):
    """ Handles parsing response structure and translating API Exceptions """
    def inner(self, *args, **kwargs):
        serialize_response = kwargs.pop('serialize', True)
        serializer = kwargs.pop('serializer', ResourceInstance)
        try:
            resp = func(self, *args, **kwargs)
        except ApiException as e:
            raise api_exception(e)
        if serialize_response:
            try:
                if six.PY2:
                    return serializer(self, json.loads(resp.data))
                return serializer(self, json.loads(resp.data.decode('utf8')))
            except ValueError:
                if six.PY2:
                    return resp.data
                return resp.data.decode('utf8')
        return resp

    return inner


class DynamicClient(object):
    """ A kubernetes client that dynamically discovers and interacts with
        the kubernetes API
    """

    def __init__(self, client, cache_file=None, discoverer=None):
        # Setting default here to delay evaluation of LazyDiscoverer class
        # until constructor is called
        discoverer = discoverer or LazyDiscoverer

        self.client = client
        self.configuration = client.configuration
        self.__discoverer = discoverer(self, cache_file)

    @property
    def resources(self):
        return self.__discoverer

    @property
    def version(self):
        return self.__discoverer.version

    def ensure_namespace(self, resource, namespace, body):
        namespace = namespace or body.get('metadata', {}).get('namespace')
        if not namespace:
            raise ValueError("Namespace is required for {}.{}".format(resource.group_version, resource.kind))
        return namespace

    def serialize_body(self, body):
        """Serialize body to raw dict so apiserver can handle it

        :param body: kubernetes resource body, current support: Union[Dict, ResourceInstance]
        """
        # This should match any `ResourceInstance` instances
        if callable(getattr(body, 'to_dict', None)):
            return body.to_dict()
        return body or {}

    def get(self, resource, name=None, namespace=None, **kwargs):
        path = resource.path(name=name, namespace=namespace)
        return self.request('get', path, **kwargs)

    def create(self, resource, body=None, namespace=None, **kwargs):
        body = self.serialize_body(body)
        if resource.namespaced:
            namespace = self.ensure_namespace(resource, namespace, body)
        path = resource.path(namespace=namespace)
        return self.request('post', path, body=body, **kwargs)

    def delete(self, resource, name=None, namespace=None, body=None, label_selector=None, field_selector=None, **kwargs):
        if not (name or label_selector or field_selector):
            raise ValueError("At least one of name|label_selector|field_selector is required")
        if resource.namespaced and not (label_selector or field_selector or namespace):
            raise ValueError("At least one of namespace|label_selector|field_selector is required")
        path = resource.path(name=name, namespace=namespace)
        return self.request('delete', path, body=body, label_selector=label_selector, field_selector=field_selector, **kwargs)

    def replace(self, resource, body=None, name=None, namespace=None, **kwargs):
        body = self.serialize_body(body)
        name = name or body.get('metadata', {}).get('name')
        if not name:
            raise ValueError("name is required to replace {}.{}".format(resource.group_version, resource.kind))
        if resource.namespaced:
            namespace = self.ensure_namespace(resource, namespace, body)
        path = resource.path(name=name, namespace=namespace)
        return self.request('put', path, body=body, **kwargs)

    def patch(self, resource, body=None, name=None, namespace=None, **kwargs):
        body = self.serialize_body(body)
        name = name or body.get('metadata', {}).get('name')
        if not name:
            raise ValueError("name is required to patch {}.{}".format(resource.group_version, resource.kind))
        if resource.namespaced:
            namespace = self.ensure_namespace(resource, namespace, body)

        content_type = kwargs.pop('content_type', 'application/strategic-merge-patch+json')
        path = resource.path(name=name, namespace=namespace)

        return self.request('patch', path, body=body, content_type=content_type, **kwargs)

    def server_side_apply(self, resource, body=None, name=None, namespace=None, force_conflicts=None, **kwargs):
        body = self.serialize_body(body)
        name = name or body.get('metadata', {}).get('name')
        if not name:
            raise ValueError("name is required to patch {}.{}".format(resource.group_version, resource.kind))
        if resource.namespaced:
            namespace = self.ensure_namespace(resource, namespace, body)

        # force content type to 'application/apply-patch+yaml'
        kwargs.update({'content_type': 'application/apply-patch+yaml'})
        path = resource.path(name=name, namespace=namespace)

        return self.request('patch', path, body=body, force_conflicts=force_conflicts, **kwargs)

    def watch(self, resource, namespace=None, name=None, label_selector=None, field_selector=None, resource_version=None, timeout=None, watcher=None, allow_watch_bookmarks=None):
        """
        Stream events for a resource from the Kubernetes API

        :param resource: The API resource object that will be used to query the API
        :param namespace: The namespace to query
        :param name: The name of the resource instance to query
        :param label_selector: The label selector with which to filter results
        :param field_selector: The field selector with which to filter results
        :param resource_version: The version with which to filter results. Only events with
                                 a resource_version greater than this value will be returned
        :param timeout: The amount of time in seconds to wait before terminating the stream
        :param watcher: The Watcher object that will be used to stream the resource
        :param allow_watch_bookmarks: Ask the API server to send BOOKMARK events

        :return: Event object with these keys:
                   'type': The type of event such as "ADDED", "DELETED", etc.
                   'raw_object': a dict representing the watched object.
                   'object': A ResourceInstance wrapping raw_object.

        Example:
            client = DynamicClient(k8s_client)
            watcher = watch.Watch()
            v1_pods = client.resources.get(api_version='v1', kind='Pod')

            for e in v1_pods.watch(resource_version=0, namespace=default, timeout=5, watcher=watcher):
                print(e['type'])
                print(e['object'].metadata)
                # If you want to gracefully stop the stream watcher
                watcher.stop()
        """
        if not watcher: watcher = watch.Watch()

        # Use field selector to query for named instance so the watch parameter is handled properly.
        if name:
            field_selector = f"metadata.name={name}"

        for event in watcher.stream(
            resource.get,
            namespace=namespace,
            field_selector=field_selector,
            label_selector=label_selector,
            resource_version=resource_version,
            serialize=False,
            timeout_seconds=timeout,
            allow_watch_bookmarks=allow_watch_bookmarks,
        ):
            event['object'] = ResourceInstance(resource, event['object'])
            yield event

    @meta_request
    def request(self, method, path, body=None, **params):
        if not path.startswith('/'):
            path = '/' + path

        path_params = params.get('path_params', {})
        query_params = params.get('query_params', [])
        if params.get('pretty') is not None:
            query_params.append(('pretty', params['pretty']))
        if params.get('_continue') is not None:
            query_params.append(('continue', params['_continue']))
        if params.get('include_uninitialized') is not None:
            query_params.append(('includeUninitialized', params['include_uninitialized']))
        if params.get('field_selector') is not None:
            query_params.append(('fieldSelector', params['field_selector']))
        if params.get('label_selector') is not None:
            query_params.append(('labelSelector', params['label_selector']))
        if params.get('limit') is not None:
            query_params.append(('limit', params['limit']))
        if params.get('resource_version') is not None:
            query_params.append(('resourceVersion', params['resource_version']))
        if params.get('timeout_seconds') is not None:
            query_params.append(('timeoutSeconds', params['timeout_seconds']))
        if params.get('watch') is not None:
            query_params.append(('watch', params['watch']))
        if params.get('grace_period_seconds') is not None:
            query_params.append(('gracePeriodSeconds', params['grace_period_seconds']))
        if params.get('propagation_policy') is not None:
            query_params.append(('propagationPolicy', params['propagation_policy']))
        if params.get('orphan_dependents') is not None:
            query_params.append(('orphanDependents', params['orphan_dependents']))
        if params.get('dry_run') is not None:
            query_params.append(('dryRun', params['dry_run']))
        if params.get('field_manager') is not None:
            query_params.append(('fieldManager', params['field_manager']))
        if params.get('force_conflicts') is not None:
            query_params.append(('force', params['force_conflicts']))
        if params.get('allow_watch_bookmarks') is not None:
            query_params.append(('allowWatchBookmarks', params['allow_watch_bookmarks']))

        header_params = params.get('header_params', {})
        form_params = []
        local_var_files = {}

        # Checking Accept header.
        new_header_params = dict((key.lower(), value) for key, value in header_params.items())
        if not 'accept' in new_header_params:
            header_params['Accept'] = self.client.select_header_accept([
                'application/json',
                'application/yaml',
            ])

        # HTTP header `Content-Type`
        if params.get('content_type'):
            header_params['Content-Type'] = params['content_type']
        else:
            header_params['Content-Type'] = self.client.select_header_content_type(['*/*'])

        # Authentication setting
        auth_settings = ['BearerToken']

        api_response = self.client.call_api(
            path,
            method.upper(),
            path_params,
            query_params,
            header_params,
            body=body,
            post_params=form_params,
            async_req=params.get('async_req'),
            files=local_var_files,
            auth_settings=auth_settings,
            _preload_content=False,
            _return_http_data_only=params.get('_return_http_data_only', True),
            _request_timeout=params.get('_request_timeout')
        )
        if params.get('async_req'):
            return api_response.get()
        else:
            return api_response

    def validate(self, definition, version=None, strict=False):
        """validate checks a kubernetes resource definition

        Args:
            definition (dict): resource definition
            version (str): version of kubernetes to validate against
            strict (bool): whether unexpected additional properties should be considered errors

        Returns:
            warnings (list), errors (list): warnings are missing validations, errors are validation failures
        """
        if not HAS_KUBERNETES_VALIDATE:
            raise KubernetesValidateMissing()

        errors = list()
        warnings = list()
        try:
            if version is None:
                try:
                    version = self.version['kubernetes']['gitVersion']
                except KeyError:
                    version = kubernetes_validate.latest_version()
            kubernetes_validate.validate(definition, version, strict)
        except kubernetes_validate.utils.ValidationError as e:
            errors.append("resource definition validation error at %s: %s" % ('.'.join([str(item) for item in e.path]), e.message))  # noqa: B306
        except VersionNotSupportedError:
            errors.append("Kubernetes version %s is not supported by kubernetes-validate" % version)
        except kubernetes_validate.utils.SchemaNotFoundError as e:
            warnings.append("Could not find schema for object kind %s with API version %s in Kubernetes version %s (possibly Custom Resource?)" %
                            (e.kind, e.api_version, e.version))
        return warnings, errors
