from chromadb.utils.distance_functions import cosine
import numpy as np


def test_cosine_zero() -> None:
    x = np.array([0.0, 0.0], dtype=np.float16)
    assert cosine(x, x) == 1.0
