# Copyright The OpenTelemetry Authors
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

from typing import Final

CLOUDFOUNDRY_APP_ID: Final = "cloudfoundry.app.id"
"""
The guid of the application.
Note: Application instrumentation should use the value from environment
variable `VCAP_APPLICATION.application_id`. This is the same value as
reported by `cf app <app-name> --guid`.
"""

CLOUDFOUNDRY_APP_INSTANCE_ID: Final = "cloudfoundry.app.instance.id"
"""
The index of the application instance. 0 when just one instance is active.
Note: CloudFoundry defines the `instance_id` in the [Loggregator v2 envelope](https://github.com/cloudfoundry/loggregator-api#v2-envelope).
It is used for logs and metrics emitted by CloudFoundry. It is
supposed to contain the application instance index for applications
deployed on the runtime.

Application instrumentation should use the value from environment
variable `CF_INSTANCE_INDEX`.
"""

CLOUDFOUNDRY_APP_NAME: Final = "cloudfoundry.app.name"
"""
The name of the application.
Note: Application instrumentation should use the value from environment
variable `VCAP_APPLICATION.application_name`. This is the same value
as reported by `cf apps`.
"""

CLOUDFOUNDRY_ORG_ID: Final = "cloudfoundry.org.id"
"""
The guid of the CloudFoundry org the application is running in.
Note: Application instrumentation should use the value from environment
variable `VCAP_APPLICATION.org_id`. This is the same value as
reported by `cf org <org-name> --guid`.
"""

CLOUDFOUNDRY_ORG_NAME: Final = "cloudfoundry.org.name"
"""
The name of the CloudFoundry organization the app is running in.
Note: Application instrumentation should use the value from environment
variable `VCAP_APPLICATION.org_name`. This is the same value as
reported by `cf orgs`.
"""

CLOUDFOUNDRY_PROCESS_ID: Final = "cloudfoundry.process.id"
"""
The UID identifying the process.
Note: Application instrumentation should use the value from environment
variable `VCAP_APPLICATION.process_id`. It is supposed to be equal to
`VCAP_APPLICATION.app_id` for applications deployed to the runtime.
For system components, this could be the actual PID.
"""

CLOUDFOUNDRY_PROCESS_TYPE: Final = "cloudfoundry.process.type"
"""
The type of process.
Note: CloudFoundry applications can consist of multiple jobs. Usually the
main process will be of type `web`. There can be additional background
tasks or side-cars with different process types.
"""

CLOUDFOUNDRY_SPACE_ID: Final = "cloudfoundry.space.id"
"""
The guid of the CloudFoundry space the application is running in.
Note: Application instrumentation should use the value from environment
variable `VCAP_APPLICATION.space_id`. This is the same value as
reported by `cf space <space-name> --guid`.
"""

CLOUDFOUNDRY_SPACE_NAME: Final = "cloudfoundry.space.name"
"""
The name of the CloudFoundry space the application is running in.
Note: Application instrumentation should use the value from environment
variable `VCAP_APPLICATION.space_name`. This is the same value as
reported by `cf spaces`.
"""

CLOUDFOUNDRY_SYSTEM_ID: Final = "cloudfoundry.system.id"
"""
A guid or another name describing the event source.
Note: CloudFoundry defines the `source_id` in the [Loggregator v2 envelope](https://github.com/cloudfoundry/loggregator-api#v2-envelope).
It is used for logs and metrics emitted by CloudFoundry. It is
supposed to contain the component name, e.g. "gorouter", for
CloudFoundry components.

When system components are instrumented, values from the
[Bosh spec](https://bosh.io/docs/jobs/#properties-spec)
should be used. The `system.id` should be set to
`spec.deployment/spec.name`.
"""

CLOUDFOUNDRY_SYSTEM_INSTANCE_ID: Final = "cloudfoundry.system.instance.id"
"""
A guid describing the concrete instance of the event source.
Note: CloudFoundry defines the `instance_id` in the [Loggregator v2 envelope](https://github.com/cloudfoundry/loggregator-api#v2-envelope).
It is used for logs and metrics emitted by CloudFoundry. It is
supposed to contain the vm id for CloudFoundry components.

When system components are instrumented, values from the
[Bosh spec](https://bosh.io/docs/jobs/#properties-spec)
should be used. The `system.instance.id` should be set to `spec.id`.
"""
