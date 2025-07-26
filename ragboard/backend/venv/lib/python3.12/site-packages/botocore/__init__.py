# Copyright (c) 2012-2013 Mitch Garnaat http://garnaat.org/
# Copyright 2012-2014 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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

import logging
import os
import re

__version__ = '1.34.162'


class NullHandler(logging.Handler):
    def emit(self, record):
        pass


# Configure default logger to do nothing
log = logging.getLogger('botocore')
log.addHandler(NullHandler())

_INITIALIZERS = []

_first_cap_regex = re.compile('(.)([A-Z][a-z]+)')
_end_cap_regex = re.compile('([a-z0-9])([A-Z])')
# The regex below handles the special case where some acronym
# name is pluralized, e.g GatewayARNs, ListWebACLs, SomeCNAMEs.
_special_case_transform = re.compile('[A-Z]{2,}s$')
# Prepopulate the cache with special cases that don't match
# our regular transformation.
_xform_cache = {
    ('CreateCachediSCSIVolume', '_'): 'create_cached_iscsi_volume',
    ('CreateCachediSCSIVolume', '-'): 'create-cached-iscsi-volume',
    ('DescribeCachediSCSIVolumes', '_'): 'describe_cached_iscsi_volumes',
    ('DescribeCachediSCSIVolumes', '-'): 'describe-cached-iscsi-volumes',
    ('DescribeStorediSCSIVolumes', '_'): 'describe_stored_iscsi_volumes',
    ('DescribeStorediSCSIVolumes', '-'): 'describe-stored-iscsi-volumes',
    ('CreateStorediSCSIVolume', '_'): 'create_stored_iscsi_volume',
    ('CreateStorediSCSIVolume', '-'): 'create-stored-iscsi-volume',
    ('ListHITsForQualificationType', '_'): 'list_hits_for_qualification_type',
    ('ListHITsForQualificationType', '-'): 'list-hits-for-qualification-type',
    ('ExecutePartiQLStatement', '_'): 'execute_partiql_statement',
    ('ExecutePartiQLStatement', '-'): 'execute-partiql-statement',
    ('ExecutePartiQLTransaction', '_'): 'execute_partiql_transaction',
    ('ExecutePartiQLTransaction', '-'): 'execute-partiql-transaction',
    ('ExecutePartiQLBatch', '_'): 'execute_partiql_batch',
    ('ExecutePartiQLBatch', '-'): 'execute-partiql-batch',
}
# The items in this dict represent partial renames to apply globally to all
# services which might have a matching argument or operation. This way a
# common mis-translation can be fixed without having to call out each
# individual case.
ScalarTypes = ('string', 'integer', 'boolean', 'timestamp', 'float', 'double')

BOTOCORE_ROOT = os.path.dirname(os.path.abspath(__file__))


# Used to specify anonymous (unsigned) request signature
class UNSIGNED:
    def __copy__(self):
        return self

    def __deepcopy__(self, memodict):
        return self


UNSIGNED = UNSIGNED()


def xform_name(name, sep='_', _xform_cache=_xform_cache):
    """Convert camel case to a "pythonic" name.

    If the name contains the ``sep`` character, then it is
    returned unchanged.

    """
    if sep in name:
        # If the sep is in the name, assume that it's already
        # transformed and return the string unchanged.
        return name
    key = (name, sep)
    if key not in _xform_cache:
        if _special_case_transform.search(name) is not None:
            is_special = _special_case_transform.search(name)
            matched = is_special.group()
            # Replace something like ARNs, ACLs with _arns, _acls.
            name = f"{name[: -len(matched)]}{sep}{matched.lower()}"
        s1 = _first_cap_regex.sub(r'\1' + sep + r'\2', name)
        transformed = _end_cap_regex.sub(r'\1' + sep + r'\2', s1).lower()
        _xform_cache[key] = transformed
    return _xform_cache[key]


def register_initializer(callback):
    """Register an initializer function for session creation.

    This initializer function will be invoked whenever a new
    `botocore.session.Session` is instantiated.

    :type callback: callable
    :param callback: A callable that accepts a single argument
        of type `botocore.session.Session`.

    """
    _INITIALIZERS.append(callback)


def unregister_initializer(callback):
    """Unregister an initializer function.

    :type callback: callable
    :param callback: A callable that was previously registered
        with `botocore.register_initializer`.

    :raises ValueError: If a callback is provided that is not currently
        registered as an initializer.

    """
    _INITIALIZERS.remove(callback)


def invoke_initializers(session):
    """Invoke all initializers for a session.

    :type session: botocore.session.Session
    :param session: The session to initialize.

    """
    for initializer in _INITIALIZERS:
        initializer(session)
