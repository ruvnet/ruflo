import subprocess

# Needs to be a module, not a file, so that local imports work.
TEST_MODULE = "chromadb.test.client.create_http_client_with_basic_auth"


def test_main() -> None:
    # This is the only way to test what we want to test: pytest does a bunch of
    # importing and other module stuff in the background, so we need a clean
    # python process to make sure we're not circular-importing.
    #
    # See https://github.com/chroma-core/chroma/issues/1554

    res = subprocess.run(["python", "-m", TEST_MODULE])
    assert res.returncode == 0
