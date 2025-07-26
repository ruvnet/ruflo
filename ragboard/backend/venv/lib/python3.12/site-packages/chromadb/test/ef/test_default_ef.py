import shutil
import os
from typing import List, Hashable

import hypothesis.strategies as st
import onnxruntime
import pytest
from hypothesis import given, settings

from chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2 import (
    ONNXMiniLM_L6_V2,
)

from chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2 import _verify_sha256


def unique_by(x: Hashable) -> Hashable:
    return x


@settings(deadline=None)
@given(
    providers=st.lists(
        st.sampled_from(onnxruntime.get_all_providers()).filter(
            lambda x: x not in onnxruntime.get_available_providers()
        ),
        unique_by=unique_by,
        min_size=1,
    )
)
def test_unavailable_provider_multiple(providers: List[str]) -> None:
    with pytest.raises(ValueError) as e:
        ef = ONNXMiniLM_L6_V2(preferred_providers=providers)
        ef(["test"])
    assert "Preferred providers must be subset of available providers" in str(e.value)


@given(
    providers=st.lists(
        st.sampled_from(onnxruntime.get_available_providers()),
        min_size=1,
        unique_by=unique_by,
    )
)
def test_available_provider(providers: List[str]) -> None:
    ef = ONNXMiniLM_L6_V2(preferred_providers=providers)
    ef(["test"])


def test_warning_no_providers_supplied() -> None:
    ef = ONNXMiniLM_L6_V2()
    ef(["test"])


@given(
    providers=st.lists(
        st.sampled_from(onnxruntime.get_available_providers()),
        min_size=1,
    ).filter(lambda x: len(x) > len(set(x)))
)
def test_provider_repeating(providers: List[str]) -> None:
    with pytest.raises(ValueError) as e:
        ef = ONNXMiniLM_L6_V2(preferred_providers=providers)
        ef(["test"])
    assert "Preferred providers must be unique" in str(e.value)


def test_invalid_sha256() -> None:
    ef = ONNXMiniLM_L6_V2()
    shutil.rmtree(ef.DOWNLOAD_PATH)  # clean up any existing models
    with pytest.raises(ValueError) as e:
        ef._MODEL_SHA256 = "invalid"
        ef(["test"])
    assert "does not match expected SHA256 hash" in str(e.value)


def test_partial_download() -> None:
    ef = ONNXMiniLM_L6_V2()
    shutil.rmtree(ef.DOWNLOAD_PATH, ignore_errors=True)  # clean up any existing models
    os.makedirs(ef.DOWNLOAD_PATH, exist_ok=True)
    path = os.path.join(ef.DOWNLOAD_PATH, ef.ARCHIVE_FILENAME)
    with open(path, "wb") as f:  # create invalid file to simulate partial download
        f.write(b"invalid")
    ef._download_model_if_not_exists()  # re-download model
    assert os.path.exists(path)
    assert _verify_sha256(
        str(os.path.join(ef.DOWNLOAD_PATH, ef.ARCHIVE_FILENAME)),
        ef._MODEL_SHA256,
    )
    assert len(ef(["test"])) == 1
