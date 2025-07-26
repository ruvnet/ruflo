import re
import sys

import chromadb_rust_bindings
import requests
from packaging.version import parse

import chromadb


def build_cli_args(**kwargs):
    args = []
    for key, value in kwargs.items():
        if isinstance(value, bool):
            if value:
                args.append(f"--{key}")
        elif value is not None:
            args.extend([f"--{key}", str(value)])
    return args


def update():
    try:
        url = f"https://api.github.com/repos/chroma-core/chroma/releases"
        response = requests.get(url)
        response.raise_for_status()
        releases = response.json()

        version_pattern = re.compile(r'^\d+\.\d+\.\d+$')
        numeric_releases = [r["tag_name"] for r in releases if version_pattern.fullmatch(r["tag_name"])]

        if not numeric_releases:
            print("Couldn't fetch the latest Chroma version")
            return

        latest = max(numeric_releases, key=parse)
        if latest == chromadb.__version__:
            print("Your Chroma version is up-to-date")
            return

        print(
            f"A new version of Chroma is available!\nIf you're using pip, run 'pip install --upgrade chromadb' to upgrade to version {latest}")

    except Exception as e:
        print("Couldn't fetch the latest Chroma version")


def app():
    args = sys.argv
    if ["chroma", "update"] in args:
        update()
        return
    try:
        chromadb_rust_bindings.cli(args)
    except KeyboardInterrupt:
        pass