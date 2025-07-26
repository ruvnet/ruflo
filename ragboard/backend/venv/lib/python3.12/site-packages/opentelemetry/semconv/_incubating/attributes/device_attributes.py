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

DEVICE_ID: Final = "device.id"
"""
A unique identifier representing the device.
Note: Its value SHOULD be identical for all apps on a device and it SHOULD NOT change if an app is uninstalled and re-installed.
However, it might be resettable by the user for all apps on a device.
Hardware IDs (e.g. vendor-specific serial number, IMEI or MAC address) MAY be used as values.

More information about Android identifier best practices can be found [here](https://developer.android.com/training/articles/user-data-ids).

> [!WARNING]
>
> This attribute may contain sensitive (PII) information. Caution should be taken when storing personal data or anything which can identify a user. GDPR and data protection laws may apply,
> ensure you do your own due diligence.
>
> Due to these reasons, this identifier is not recommended for consumer applications and will likely result in rejection from both Google Play and App Store.
> However, it may be appropriate for specific enterprise scenarios, such as kiosk devices or enterprise-managed devices, with appropriate compliance clearance.
> Any instrumentation providing this identifier MUST implement it as an opt-in feature.
>
> See [`app.installation.id`](/docs/registry/attributes/app.md#app-installation-id) for a more privacy-preserving alternative.
"""

DEVICE_MANUFACTURER: Final = "device.manufacturer"
"""
The name of the device manufacturer.
Note: The Android OS provides this field via [Build](https://developer.android.com/reference/android/os/Build#MANUFACTURER). iOS apps SHOULD hardcode the value `Apple`.
"""

DEVICE_MODEL_IDENTIFIER: Final = "device.model.identifier"
"""
The model identifier for the device.
Note: It's recommended this value represents a machine-readable version of the model identifier rather than the market or consumer-friendly name of the device.
"""

DEVICE_MODEL_NAME: Final = "device.model.name"
"""
The marketing name for the device model.
Note: It's recommended this value represents a human-readable version of the device model rather than a machine-readable alternative.
"""
