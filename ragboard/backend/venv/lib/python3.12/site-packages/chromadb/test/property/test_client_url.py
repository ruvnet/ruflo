from typing import Optional
from urllib.parse import urlparse

import pytest
from hypothesis import given, strategies as st

from chromadb.api.fastapi import FastAPI


def hostname_strategy() -> st.SearchStrategy[str]:
    label = st.text(
        alphabet=st.characters(min_codepoint=97, max_codepoint=122),
        min_size=1,
        max_size=63,
    )
    return st.lists(label, min_size=1, max_size=3).map("-".join)


tld_list = ["com", "org", "net", "edu"]


def domain_strategy() -> st.SearchStrategy[str]:
    label = st.text(
        alphabet=st.characters(min_codepoint=97, max_codepoint=122),
        min_size=1,
        max_size=63,
    )
    tld = st.sampled_from(tld_list)
    return st.tuples(label, tld).map(".".join)


port_strategy = st.one_of(st.integers(min_value=1, max_value=65535), st.none())

ssl_enabled_strategy = st.booleans()


def url_path_strategy() -> st.SearchStrategy[str]:
    path_segment = st.text(
        alphabet=st.sampled_from("abcdefghijklmnopqrstuvwxyz/-_"),
        min_size=1,
        max_size=10,
    )
    return (
        st.lists(path_segment, min_size=1, max_size=5)
        .map("/".join)
        .map(lambda x: "/" + x)
    )


def is_valid_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return all([parsed.scheme, parsed.netloc])
    except Exception:
        return False


def generate_valid_domain_url() -> st.SearchStrategy[str]:
    return st.builds(
        lambda url_scheme, hostname, url_path: f"{url_scheme}{hostname}{url_path}",
        url_scheme=st.sampled_from(["http://", "https://"]),
        hostname=domain_strategy(),
        url_path=url_path_strategy(),
    )


def generate_invalid_domain_url() -> st.SearchStrategy[str]:
    return st.builds(
        lambda url_scheme, hostname, url_path: f"{url_scheme}{hostname}{url_path}",
        url_scheme=st.builds(
            lambda scheme, suffix: f"{scheme}{suffix}",
            scheme=st.text(max_size=10),
            suffix=st.sampled_from(["://", ":///", ":////", ""]),
        ),
        hostname=domain_strategy(),
        url_path=url_path_strategy(),
    )


host_or_domain_strategy = st.one_of(
    generate_valid_domain_url(), domain_strategy(), st.sampled_from(["localhost"])
)


@given(
    hostname=host_or_domain_strategy,
    port=port_strategy,
    ssl_enabled=ssl_enabled_strategy,
    default_api_path=st.sampled_from(["/api/v1", "/api/v2", None]),
)
def test_url_resolve(
    hostname: str,
    port: Optional[int],
    ssl_enabled: bool,
    default_api_path: Optional[str],
) -> None:
    _url = FastAPI.resolve_url(
        chroma_server_host=hostname,
        chroma_server_http_port=port,
        chroma_server_ssl_enabled=ssl_enabled,
        default_api_path=default_api_path,
    )
    assert is_valid_url(_url), f"Invalid URL: {_url}"
    assert (
        _url.startswith("https") if ssl_enabled else _url.startswith("http")
    ), f"Invalid URL: {_url} - SSL Enabled: {ssl_enabled}"
    if hostname.startswith("http"):
        assert ":" + str(port) not in _url, f"Port in URL not expected: {_url}"
    else:
        assert ":" + str(port) in _url, f"Port in URL expected: {_url}"
    if default_api_path:
        assert _url.endswith(default_api_path), f"Invalid URL: {_url}"


@given(
    hostname=generate_invalid_domain_url(),
    port=port_strategy,
    ssl_enabled=ssl_enabled_strategy,
    default_api_path=st.sampled_from(["/api/v1", "/api/v2", None]),
)
def test_resolve_invalid(
    hostname: str,
    port: Optional[int],
    ssl_enabled: bool,
    default_api_path: Optional[str],
) -> None:
    with pytest.raises(ValueError) as e:
        FastAPI.resolve_url(
            chroma_server_host=hostname,
            chroma_server_http_port=port,
            chroma_server_ssl_enabled=ssl_enabled,
            default_api_path=default_api_path,
        )
    assert "Invalid URL" in str(e.value)
