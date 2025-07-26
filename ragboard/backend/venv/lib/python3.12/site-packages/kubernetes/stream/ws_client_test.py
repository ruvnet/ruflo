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

import unittest

from .ws_client import get_websocket_url
from .ws_client import websocket_proxycare
from kubernetes.client.configuration import Configuration

try:
    import urllib3
    urllib3.disable_warnings()
except ImportError:
    pass

def dictval(dict, key, default=None):
    try:
        val = dict[key]
    except KeyError:
        val = default
    return val

class WSClientTest(unittest.TestCase):

    def test_websocket_client(self):
        for url, ws_url in [
                ('http://localhost/api', 'ws://localhost/api'),
                ('https://localhost/api', 'wss://localhost/api'),
                ('https://domain.com/api', 'wss://domain.com/api'),
                ('https://api.domain.com/api', 'wss://api.domain.com/api'),
                ('http://api.domain.com', 'ws://api.domain.com'),
                ('https://api.domain.com', 'wss://api.domain.com'),
                ('http://api.domain.com/', 'ws://api.domain.com/'),
                ('https://api.domain.com/', 'wss://api.domain.com/'),
                ]:
            self.assertEqual(get_websocket_url(url), ws_url)

    def test_websocket_proxycare(self):
        for proxy, idpass, no_proxy, expect_host, expect_port, expect_auth, expect_noproxy in [
                ( None,                             None,        None,                            None,                None, None, None ),
                ( 'http://proxy.example.com:8080/', None,        None,                            'proxy.example.com', 8080, None, None ),
                ( 'http://proxy.example.com:8080/', 'user:pass', None,                            'proxy.example.com', 8080, ('user','pass'), None),
                ( 'http://proxy.example.com:8080/', 'user:pass', '',                              'proxy.example.com', 8080, ('user','pass'), None),
                ( 'http://proxy.example.com:8080/', 'user:pass', '*',                             'proxy.example.com', 8080, ('user','pass'), ['*']),
                ( 'http://proxy.example.com:8080/', 'user:pass', '.example.com',                  'proxy.example.com', 8080, ('user','pass'), ['.example.com']),
                ( 'http://proxy.example.com:8080/', 'user:pass', 'localhost,.local,.example.com',  'proxy.example.com', 8080, ('user','pass'), ['localhost','.local','.example.com']),
                ]:
            # setup input
            config = Configuration()
            if proxy is not None:
                setattr(config, 'proxy', proxy)
            if idpass is not None:
                setattr(config, 'proxy_headers', urllib3.util.make_headers(proxy_basic_auth=idpass))
            if no_proxy is not None:
                setattr(config, 'no_proxy', no_proxy)
            # setup done
            # test starts
            connect_opt = websocket_proxycare( {}, config, None, None)
            self.assertEqual( dictval(connect_opt,'http_proxy_host'), expect_host)
            self.assertEqual( dictval(connect_opt,'http_proxy_port'), expect_port)
            self.assertEqual( dictval(connect_opt,'http_proxy_auth'), expect_auth)
            self.assertEqual( dictval(connect_opt,'http_no_proxy'), expect_noproxy)

if __name__ == '__main__':
    unittest.main()
