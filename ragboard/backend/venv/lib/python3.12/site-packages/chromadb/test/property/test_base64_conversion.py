from hypothesis import given, strategies as st
from chromadb.api.types import (
    optional_embeddings_to_base64_strings,
    optional_base64_strings_to_embeddings,
)
import numpy as np
import math


@given(st.lists(st.lists(st.integers(min_value=-128, max_value=127))))
def test_base64_conversion_is_identity_i8(embeddings) -> None:  # type: ignore
    b64_strings = optional_embeddings_to_base64_strings(embeddings)
    assert b64_strings is not None
    assert len(b64_strings) == len(embeddings)
    decoded_embeddings = optional_base64_strings_to_embeddings(b64_strings)
    for orig, decoded in zip(embeddings, decoded_embeddings):  # type: ignore
        np.testing.assert_allclose(orig, decoded, rtol=1e-6)


@given(st.lists(st.lists(st.floats(width=16))))
def test_base64_conversion_is_identity_f16(embeddings) -> None:  # type: ignore
    b64_strings = optional_embeddings_to_base64_strings(embeddings)
    assert b64_strings is not None
    assert len(b64_strings) == len(embeddings)
    decoded_embeddings = optional_base64_strings_to_embeddings(b64_strings)
    for orig, decoded in zip(embeddings, decoded_embeddings):  # type: ignore
        np.testing.assert_allclose(orig, decoded, rtol=1e-6)


@given(st.lists(st.lists(st.floats(width=32))))
def test_base64_conversion_is_identity_f32(embeddings) -> None:  # type: ignore
    b64_strings = optional_embeddings_to_base64_strings(embeddings)
    assert b64_strings is not None
    assert len(b64_strings) == len(embeddings)
    decoded_embeddings = optional_base64_strings_to_embeddings(b64_strings)
    for orig, decoded in zip(embeddings, decoded_embeddings):  # type: ignore
        np.testing.assert_allclose(orig, decoded, rtol=1e-6)


@given(st.lists(st.lists(st.floats(width=64))))
def test_base64_conversion_is_identity_f64(embeddings) -> None:  # type: ignore
    b64_strings = optional_embeddings_to_base64_strings(embeddings)
    assert b64_strings is not None
    assert len(b64_strings) == len(embeddings)
    decoded_embeddings = optional_base64_strings_to_embeddings(b64_strings)

    expected_embeddings = []
    for embedding in embeddings:
        expected_embedding = []
        for value in embedding:
            if math.isnan(value):
                expected_embedding.append(float("nan"))
            elif value > np.finfo(np.float32).max:
                expected_embedding.append(float("inf"))
            elif value < np.finfo(np.float32).min:
                expected_embedding.append(float("-inf"))
            else:
                f32_value = np.float32(value)
                expected_embedding.append(float(f32_value))
        expected_embeddings.append(expected_embedding)

    for orig, decoded in zip(expected_embeddings, decoded_embeddings):  # type: ignore
        np.testing.assert_allclose(orig, decoded, rtol=1e-6)
