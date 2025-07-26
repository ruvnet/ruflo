# Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"). You
# may not use this file except in compliance with the License. A copy of
# the License is located at
#
# https://aws.amazon.com/apache2.0/
#
# or in the "license" file accompanying this file. This file is
# distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
# ANY KIND, either express or implied. See the License for the specific
# language governing permissions and limitations under the License.
from boto3.resources.action import CustomModeledAction


def inject_delete_tags(event_emitter, **kwargs):
    action_model = {
        'request': {
            'operation': 'DeleteTags',
            'params': [
                {
                    'target': 'Resources[0]',
                    'source': 'identifier',
                    'name': 'Id',
                }
            ],
        }
    }
    action = CustomModeledAction(
        'delete_tags', action_model, delete_tags, event_emitter
    )
    action.inject(**kwargs)


def delete_tags(self, **kwargs):
    kwargs['Resources'] = [self.id]
    return self.meta.client.delete_tags(**kwargs)
