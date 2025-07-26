# Copyright 2018 The Kubernetes Authors.
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
import json
import os
import subprocess
import sys

from .config_exception import ConfigException


class ExecProvider(object):
    """
    Implementation of the proposal for out-of-tree client
    authentication providers as described here --
    https://github.com/kubernetes/community/blob/master/contributors/design-proposals/auth/kubectl-exec-plugins.md

    Missing from implementation:

    * TLS cert support
    * caching
    """

    def __init__(self, exec_config, cwd, cluster=None):
        """
        exec_config must be of type ConfigNode because we depend on
        safe_get(self, key) to correctly handle optional exec provider
        config parameters.
        """
        for key in ['command', 'apiVersion']:
            if key not in exec_config:
                raise ConfigException(
                    'exec: malformed request. missing key \'%s\'' % key)
        self.api_version = exec_config['apiVersion']
        self.args = [exec_config['command']]
        if exec_config.safe_get('args'):
            self.args.extend(exec_config['args'])
        self.env = os.environ.copy()
        if exec_config.safe_get('env'):
            additional_vars = {}
            for item in exec_config['env']:
                name = item['name']
                value = item['value']
                additional_vars[name] = value
            self.env.update(additional_vars)
        if exec_config.safe_get('provideClusterInfo'):
            self.cluster = cluster
        else:
            self.cluster = None
        self.cwd = cwd or None
    
    @property
    def shell(self):
        # for windows systems `shell` should be `True`
        # for other systems like linux or darwin `shell` should be `False`
        # referenes:
        # https://github.com/kubernetes-client/python/pull/2289
        # https://docs.python.org/3/library/sys.html#sys.platform
        return sys.platform in ("win32", "cygwin")

    def run(self, previous_response=None):
        is_interactive = hasattr(sys.stdout, 'isatty') and sys.stdout.isatty()
        kubernetes_exec_info = {
            'apiVersion': self.api_version,
            'kind': 'ExecCredential',
            'spec': {
                'interactive': is_interactive
            }
        }
        if previous_response:
            kubernetes_exec_info['spec']['response'] = previous_response
        if self.cluster:
            kubernetes_exec_info['spec']['cluster'] = self.cluster.value

        self.env['KUBERNETES_EXEC_INFO'] = json.dumps(kubernetes_exec_info)
        process = subprocess.Popen(
            self.args,
            stdout=subprocess.PIPE,
            stderr=sys.stderr if is_interactive else subprocess.PIPE,
            stdin=sys.stdin if is_interactive else None,
            cwd=self.cwd,
            env=self.env,
            universal_newlines=True,
            shell=self.shell)
        (stdout, stderr) = process.communicate()
        exit_code = process.wait()
        if exit_code != 0:
            msg = 'exec: process returned %d' % exit_code
            stderr = stderr.strip()
            if stderr:
                msg += '. %s' % stderr
            raise ConfigException(msg)
        try:
            data = json.loads(stdout)
        except ValueError as de:
            raise ConfigException(
                'exec: failed to decode process output: %s' % de)
        for key in ('apiVersion', 'kind', 'status'):
            if key not in data:
                raise ConfigException(
                    'exec: malformed response. missing key \'%s\'' % key)
        if data['apiVersion'] != self.api_version:
            raise ConfigException(
                'exec: plugin api version %s does not match %s' %
                (data['apiVersion'], self.api_version))
        return data['status']
