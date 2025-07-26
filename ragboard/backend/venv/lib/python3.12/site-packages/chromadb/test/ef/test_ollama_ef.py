import pytest

from chromadb.utils.embedding_functions.ollama_embedding_function import (
    OllamaEmbeddingFunction,
)


def test_ollama_default_model() -> None:
    pytest.importorskip("ollama", reason="ollama not installed")
    ef = OllamaEmbeddingFunction()
    embeddings = ef(["Here is an article about llamas...", "this is another article"])
    assert embeddings is not None
    assert len(embeddings) == 2
    assert all(len(e) == 384 for e in embeddings)


def test_ollama_unknown_model() -> None:
    pytest.importorskip("ollama", reason="ollama not installed")
    model_name = "unknown-model"
    ef = OllamaEmbeddingFunction(model_name=model_name)
    with pytest.raises(Exception) as e:
        ef(["Here is an article about llamas...", "this is another article"])
    assert f'model "{model_name}" not found' in str(e.value)


def test_ollama_backward_compat() -> None:
    pytest.importorskip("ollama", reason="ollama not installed")
    ef = OllamaEmbeddingFunction(url="http://localhost:11434/api/embeddings")
    embeddings = ef(["Here is an article about llamas...", "this is another article"])
    assert embeddings is not None


def test_wrong_url() -> None:
    pytest.importorskip("ollama", reason="ollama not installed")
    ef = OllamaEmbeddingFunction(url="http://localhost:11434/this_is_wrong")
    with pytest.raises(Exception) as e:
        ef(["Here is an article about llamas...", "this is another article"])
    assert "404" in str(e.value)


def test_ollama_ask_user_to_install() -> None:
    try:
        from ollama import Client  # noqa: F401
    except ImportError:
        pass
    else:
        pytest.skip("ollama python package is installed")
    with pytest.raises(ValueError) as e:
        OllamaEmbeddingFunction()
    assert "The ollama python package is not installed" in str(e.value)
