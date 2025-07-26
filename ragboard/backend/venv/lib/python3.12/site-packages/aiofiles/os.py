"""Async executor versions of file functions from the os module."""
import os

from . import ospath as path
from .ospath import wrap

__all__ = [
    "path",
    "stat",
    "statvfs",
    "rename",
    "renames",
    "replace",
    "remove",
    "unlink",
    "mkdir",
    "makedirs",
    "rmdir",
    "removedirs",
    "link",
    "symlink",
    "readlink",
    "listdir",
    "scandir",
    "access",
    "sendfile",
    "wrap",
]


stat = wrap(os.stat)
rename = wrap(os.rename)
renames = wrap(os.renames)
replace = wrap(os.replace)
remove = wrap(os.remove)
unlink = wrap(os.unlink)
mkdir = wrap(os.mkdir)
makedirs = wrap(os.makedirs)
rmdir = wrap(os.rmdir)
removedirs = wrap(os.removedirs)
link = wrap(os.link)
symlink = wrap(os.symlink)
readlink = wrap(os.readlink)
listdir = wrap(os.listdir)
scandir = wrap(os.scandir)
access = wrap(os.access)

if hasattr(os, "sendfile"):
    sendfile = wrap(os.sendfile)
if hasattr(os, "statvfs"):
    statvfs = wrap(os.statvfs)
