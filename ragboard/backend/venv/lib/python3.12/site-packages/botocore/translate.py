# Copyright (c) 2012-2013 Mitch Garnaat http://garnaat.org/
# Copyright 2012-2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# http://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
import copy

from botocore.utils import merge_dicts


def build_retry_config(
    endpoint_prefix, retry_model, definitions, client_retry_config=None
):
    service_config = retry_model.get(endpoint_prefix, {})
    resolve_references(service_config, definitions)
    # We want to merge the global defaults with the service specific
    # defaults, with the service specific defaults taking precedence.
    # So we use the global defaults as the base.
    #
    # A deepcopy is done on the retry defaults because it ensures the
    # retry model has no chance of getting mutated when the service specific
    # configuration or client retry config is merged in.
    final_retry_config = {
        '__default__': copy.deepcopy(retry_model.get('__default__', {}))
    }
    resolve_references(final_retry_config, definitions)
    # The merge the service specific config on top.
    merge_dicts(final_retry_config, service_config)
    if client_retry_config is not None:
        _merge_client_retry_config(final_retry_config, client_retry_config)
    return final_retry_config


def _merge_client_retry_config(retry_config, client_retry_config):
    max_retry_attempts_override = client_retry_config.get('max_attempts')
    if max_retry_attempts_override is not None:
        # In the retry config, the max_attempts refers to the maximum number
        # of requests in general will be made. However, for the client's
        # retry config it refers to how many retry attempts will be made at
        # most. So to translate this number from the client config, one is
        # added to convert it to the maximum number request that will be made
        # by including the initial request.
        #
        # It is also important to note that if we ever support per operation
        # configuration in the retry model via the client, we will need to
        # revisit this logic to make sure max_attempts gets applied
        # per operation.
        retry_config['__default__']['max_attempts'] = (
            max_retry_attempts_override + 1
        )


def resolve_references(config, definitions):
    """Recursively replace $ref keys.

    To cut down on duplication, common definitions can be declared
    (and passed in via the ``definitions`` attribute) and then
    references as {"$ref": "name"}, when this happens the reference
    dict is placed with the value from the ``definition`` dict.

    This is recursively done.

    """
    for key, value in config.items():
        if isinstance(value, dict):
            if len(value) == 1 and list(value.keys())[0] == '$ref':
                # Then we need to resolve this reference.
                config[key] = definitions[list(value.values())[0]]
            else:
                resolve_references(value, definitions)
