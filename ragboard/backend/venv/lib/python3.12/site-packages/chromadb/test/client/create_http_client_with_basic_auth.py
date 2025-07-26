# This file is used by test_create_http_client.py to test the initialization
# of an HttpClient class with auth settings.
#
# See https://github.com/chroma-core/chroma/issues/1554

import chromadb
from chromadb.config import Settings
import sys


def main() -> None:
    try:
        chromadb.HttpClient(
            host="localhost",
            port=8000,
            settings=Settings(
                chroma_client_auth_provider="chromadb.auth.basic_authn.BasicAuthClientProvider",
                chroma_client_auth_credentials="admin:testDb@home2",
            ),
        )
    except ValueError:
        # We don't expect to be able to connect to Chroma. We just want to make sure
        # there isn't an ImportError.
        sys.exit(0)


if __name__ == "__main__":
    main()
