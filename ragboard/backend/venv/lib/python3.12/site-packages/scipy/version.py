
"""
Module to expose more detailed version info for the installed `scipy`
"""
version = "1.16.0"
full_version = version
short_version = version.split('.dev')[0]
git_revision = "4d3dcc103612a2edaec7069638b7f8d0d75cab8b"
release = 'dev' not in version and '+' not in version

if not release:
    version = full_version
