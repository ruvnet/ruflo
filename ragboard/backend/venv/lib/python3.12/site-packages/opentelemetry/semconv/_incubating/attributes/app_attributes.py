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

APP_INSTALLATION_ID: Final = "app.installation.id"
"""
A unique identifier representing the installation of an application on a specific device.
Note: Its value SHOULD persist across launches of the same application installation, including through application upgrades.
It SHOULD change if the application is uninstalled or if all applications of the vendor are uninstalled.
Additionally, users might be able to reset this value (e.g. by clearing application data).
If an app is installed multiple times on the same device (e.g. in different accounts on Android), each `app.installation.id` SHOULD have a different value.
If multiple OpenTelemetry SDKs are used within the same application, they SHOULD use the same value for `app.installation.id`.
Hardware IDs (e.g. serial number, IMEI, MAC address) MUST NOT be used as the `app.installation.id`.

For iOS, this value SHOULD be equal to the [vendor identifier](https://developer.apple.com/documentation/uikit/uidevice/identifierforvendor).

For Android, examples of `app.installation.id` implementations include:

- [Firebase Installation ID](https://firebase.google.com/docs/projects/manage-installations).
- A globally unique UUID which is persisted across sessions in your application.
- [App set ID](https://developer.android.com/identity/app-set-id).
- [`Settings.getString(Settings.Secure.ANDROID_ID)`](https://developer.android.com/reference/android/provider/Settings.Secure#ANDROID_ID).

More information about Android identifier best practices can be found [here](https://developer.android.com/training/articles/user-data-ids).
"""

APP_SCREEN_COORDINATE_X: Final = "app.screen.coordinate.x"
"""
The x (horizontal) coordinate of a screen coordinate, in screen pixels.
"""

APP_SCREEN_COORDINATE_Y: Final = "app.screen.coordinate.y"
"""
The y (vertical) component of a screen coordinate, in screen pixels.
"""

APP_WIDGET_ID: Final = "app.widget.id"
"""
An identifier that uniquely differentiates this widget from other widgets in the same application.
Note: A widget is an application component, typically an on-screen visual GUI element.
"""

APP_WIDGET_NAME: Final = "app.widget.name"
"""
The name of an application widget.
Note: A widget is an application component, typically an on-screen visual GUI element.
"""
