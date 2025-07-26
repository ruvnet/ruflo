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

from os.path import exists, expanduser

from .config_exception import ConfigException
from .incluster_config import load_incluster_config
from .kube_config import (KUBE_CONFIG_DEFAULT_LOCATION,
                          list_kube_config_contexts, load_kube_config,
                          load_kube_config_from_dict, new_client_from_config, new_client_from_config_dict)


def load_config(**kwargs):
    """
    Wrapper function to load the kube_config.
    It will initially try to load_kube_config from provided path,
    then check if the KUBE_CONFIG_DEFAULT_LOCATION exists
    If neither exists, it will fall back to load_incluster_config
    and inform the user accordingly.

    :param kwargs: A combination of all possible kwargs that
    can be passed to either load_kube_config or
    load_incluster_config functions.
    """
    if "config_file" in kwargs.keys():
        load_kube_config(**kwargs)
    elif "kube_config_path" in kwargs.keys():
        kwargs["config_file"] = kwargs.pop("kube_config_path", None)
        load_kube_config(**kwargs)
    elif exists(expanduser(KUBE_CONFIG_DEFAULT_LOCATION)):
        load_kube_config(**kwargs)
    else:
        print(
            "kube_config_path not provided and "
            "default location ({0}) does not exist. "
            "Using inCluster Config. "
            "This might not work.".format(KUBE_CONFIG_DEFAULT_LOCATION))
        load_incluster_config(**kwargs)
