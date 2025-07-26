# Inference code generated from the JSON schema spec in @huggingface/tasks.
#
# See:
#   - script: https://github.com/huggingface/huggingface.js/blob/main/packages/tasks/scripts/inference-codegen.ts
#   - specs:  https://github.com/huggingface/huggingface.js/tree/main/packages/tasks/src/tasks.
from typing import Any, Optional

from .base import BaseInferenceType, dataclass_with_extra


@dataclass_with_extra
class TextToImageParameters(BaseInferenceType):
    """Additional inference parameters for Text To Image"""

    guidance_scale: Optional[float] = None
    """A higher guidance scale value encourages the model to generate images closely linked to
    the text prompt, but values too high may cause saturation and other artifacts.
    """
    height: Optional[int] = None
    """The height in pixels of the output image"""
    negative_prompt: Optional[str] = None
    """One prompt to guide what NOT to include in image generation."""
    num_inference_steps: Optional[int] = None
    """The number of denoising steps. More denoising steps usually lead to a higher quality
    image at the expense of slower inference.
    """
    scheduler: Optional[str] = None
    """Override the scheduler with a compatible one."""
    seed: Optional[int] = None
    """Seed for the random number generator."""
    width: Optional[int] = None
    """The width in pixels of the output image"""


@dataclass_with_extra
class TextToImageInput(BaseInferenceType):
    """Inputs for Text To Image inference"""

    inputs: str
    """The input text data (sometimes called "prompt")"""
    parameters: Optional[TextToImageParameters] = None
    """Additional inference parameters for Text To Image"""


@dataclass_with_extra
class TextToImageOutput(BaseInferenceType):
    """Outputs of inference for the Text To Image task"""

    image: Any
    """The generated image returned as raw bytes in the payload."""
