# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, List, Optional

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class TextToVideoParameters(BaseInferenceType):
    """Additional inference parameters for Text To Video"""

    guidance_scale: Optional[float] = None
    """A higher guidance scale value encourages the model to generate videos closely linked to
    the text prompt, but values too high may cause saturation and other artifacts.
    """
    negative_prompt: Optional[List[str]] = None
    """One or several prompt to guide what NOT to include in video generation."""
    num_frames: Optional[float] = None
    """The num_frames parameter determines how many video frames are generated."""
    num_inference_steps: Optional[int] = None
    """The number of denoising steps. More denoising steps usually lead to a higher quality
    video at the expense of slower inference.
    """
    seed: Optional[int] = None
    """Seed for the random number generator."""


@dataclass_with_extra
class TextToVideoInput(BaseInferenceType):
    """Inputs for Text To Video inference"""

    inputs: str
    """The input text data (sometimes called "prompt")"""
    parameters: Optional[TextToVideoParameters] = None
    """Additional inference parameters for Text To Video"""


@dataclass_with_extra
class TextToVideoOutput(BaseInferenceType):
    """Outputs of inference for the Text To Video task"""

    video: Any
    """The generated video returned as raw bytes in the payload."""
