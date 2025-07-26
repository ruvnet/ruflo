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

FILE_ACCESSED: Final = "file.accessed"
"""
Time when the file was last accessed, in ISO 8601 format.
Note: This attribute might not be supported by some file systems — NFS, FAT32, in embedded OS, etc.
"""

FILE_ATTRIBUTES: Final = "file.attributes"
"""
Array of file attributes.
Note: Attributes names depend on the OS or file system. Here’s a non-exhaustive list of values expected for this attribute: `archive`, `compressed`, `directory`, `encrypted`, `execute`, `hidden`, `immutable`, `journaled`, `read`, `readonly`, `symbolic link`, `system`, `temporary`, `write`.
"""

FILE_CHANGED: Final = "file.changed"
"""
Time when the file attributes or metadata was last changed, in ISO 8601 format.
Note: `file.changed` captures the time when any of the file's properties or attributes (including the content) are changed, while `file.modified` captures the timestamp when the file content is modified.
"""

FILE_CREATED: Final = "file.created"
"""
Time when the file was created, in ISO 8601 format.
Note: This attribute might not be supported by some file systems — NFS, FAT32, in embedded OS, etc.
"""

FILE_DIRECTORY: Final = "file.directory"
"""
Directory where the file is located. It should include the drive letter, when appropriate.
"""

FILE_EXTENSION: Final = "file.extension"
"""
File extension, excluding the leading dot.
Note: When the file name has multiple extensions (example.tar.gz), only the last one should be captured ("gz", not "tar.gz").
"""

FILE_FORK_NAME: Final = "file.fork_name"
"""
Name of the fork. A fork is additional data associated with a filesystem object.
Note: On Linux, a resource fork is used to store additional data with a filesystem object. A file always has at least one fork for the data portion, and additional forks may exist.
On NTFS, this is analogous to an Alternate Data Stream (ADS), and the default data stream for a file is just called $DATA. Zone.Identifier is commonly used by Windows to track contents downloaded from the Internet. An ADS is typically of the form: C:\\path\\to\\filename.extension:some_fork_name, and some_fork_name is the value that should populate `fork_name`. `filename.extension` should populate `file.name`, and `extension` should populate `file.extension`. The full path, `file.path`, will include the fork name.
"""

FILE_GROUP_ID: Final = "file.group.id"
"""
Primary Group ID (GID) of the file.
"""

FILE_GROUP_NAME: Final = "file.group.name"
"""
Primary group name of the file.
"""

FILE_INODE: Final = "file.inode"
"""
Inode representing the file in the filesystem.
"""

FILE_MODE: Final = "file.mode"
"""
Mode of the file in octal representation.
"""

FILE_MODIFIED: Final = "file.modified"
"""
Time when the file content was last modified, in ISO 8601 format.
"""

FILE_NAME: Final = "file.name"
"""
Name of the file including the extension, without the directory.
"""

FILE_OWNER_ID: Final = "file.owner.id"
"""
The user ID (UID) or security identifier (SID) of the file owner.
"""

FILE_OWNER_NAME: Final = "file.owner.name"
"""
Username of the file owner.
"""

FILE_PATH: Final = "file.path"
"""
Full path to the file, including the file name. It should include the drive letter, when appropriate.
"""

FILE_SIZE: Final = "file.size"
"""
File size in bytes.
"""

FILE_SYMBOLIC_LINK_TARGET_PATH: Final = "file.symbolic_link.target_path"
"""
Path to the target of a symbolic link.
Note: This attribute is only applicable to symbolic links.
"""
