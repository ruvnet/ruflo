import inspect
import json
import os
from dataclasses import Field, asdict, dataclass, is_dataclass
from pathlib import Path
from typing import Any, Callable, ClassVar, Dict, List, Optional, Protocol, Tuple, Type, TypeVar, Union

import packaging.version

from . import constants
from .errors import EntryNotFoundError, HfHubHTTPError
from .file_download import hf_hub_download
from .hf_api import HfApi
from .repocard import ModelCard, ModelCardData
from .utils import (
    SoftTemporaryDirectory,
    is_jsonable,
    is_safetensors_available,
    is_simple_optional_type,
    is_torch_available,
    logging,
    unwrap_simple_optional_type,
    validate_hf_hub_args,
)


if is_torch_available():
    import torch  # type: ignore

if is_safetensors_available():
    import safetensors
    from safetensors.torch import load_model as load_model_as_safetensor
    from safetensors.torch import save_model as save_model_as_safetensor


logger = logging.get_logger(__name__)


# Type alias for dataclass instances, copied from https://github.com/python/typeshed/blob/9f28171658b9ca6c32a7cb93fbb99fc92b17858b/stdlib/_typeshed/__init__.pyi#L349
class DataclassInstance(Protocol):
    __dataclass_fields__: ClassVar[Dict[str, Field]]


# Generic variable that is either ModelHubMixin or a subclass thereof
T = TypeVar("T", bound="ModelHubMixin")
# Generic variable to represent an args type
ARGS_T = TypeVar("ARGS_T")
ENCODER_T = Callable[[ARGS_T], Any]
DECODER_T = Callable[[Any], ARGS_T]
CODER_T = Tuple[ENCODER_T, DECODER_T]


DEFAULT_MODEL_CARD = """
---
# For reference on model card metadata, see the spec: https://github.com/huggingface/hub-docs/blob/main/modelcard.md?plain=1
# Doc / guide: https://huggingface.co/docs/hub/model-cards
{{ card_data }}
---

This model has been pushed to the Hub using the [PytorchModelHubMixin](https://huggingface.co/docs/huggingface_hub/package_reference/mixins#huggingface_hub.PyTorchModelHubMixin) integration:
- Code: {{ repo_url | default("[More Information Needed]", true) }}
- Paper: {{ paper_url | default("[More Information Needed]", true) }}
- Docs: {{ docs_url | default("[More Information Needed]", true) }}
"""


@dataclass
class MixinInfo:
    model_card_template: str
    model_card_data: ModelCardData
    docs_url: Optional[str] = None
    paper_url: Optional[str] = None
    repo_url: Optional[str] = None


class ModelHubMixin:
    """
    A generic mixin to integrate ANY machine learning framework with the Hub.

    To integrate your framework, your model class must inherit from this class. Custom logic for saving/loading models
    have to be overwritten in  [`_from_pretrained`] and [`_save_pretrained`]. [`PyTorchModelHubMixin`] is a good example
    of mixin integration with the Hub. Check out our [integration guide](../guides/integrations) for more instructions.

    When inheriting from [`ModelHubMixin`], you can define class-level attributes. These attributes are not passed to
    `__init__` but to the class definition itself. This is useful to define metadata about the library integrating
    [`ModelHubMixin`].

    For more details on how to integrate the mixin with your library, checkout the [integration guide](../guides/integrations).

    Args:
        repo_url (`str`, *optional*):
            URL of the library repository. Used to generate model card.
        paper_url (`str`, *optional*):
            URL of the library paper. Used to generate model card.
        docs_url (`str`, *optional*):
            URL of the library documentation. Used to generate model card.
        model_card_template (`str`, *optional*):
            Template of the model card. Used to generate model card. Defaults to a generic template.
        language (`str` or `List[str]`, *optional*):
            Language supported by the library. Used to generate model card.
        library_name (`str`, *optional*):
            Name of the library integrating ModelHubMixin. Used to generate model card.
        license (`str`, *optional*):
            License of the library integrating ModelHubMixin. Used to generate model card.
            E.g: "apache-2.0"
        license_name (`str`, *optional*):
            Name of the library integrating ModelHubMixin. Used to generate model card.
            Only used if `license` is set to `other`.
            E.g: "coqui-public-model-license".
        license_link (`str`, *optional*):
            URL to the license of the library integrating ModelHubMixin. Used to generate model card.
            Only used if `license` is set to `other` and `license_name` is set.
            E.g: "https://coqui.ai/cpml".
        pipeline_tag (`str`, *optional*):
            Tag of the pipeline. Used to generate model card. E.g. "text-classification".
        tags (`List[str]`, *optional*):
            Tags to be added to the model card. Used to generate model card. E.g. ["computer-vision"]
        coders (`Dict[Type, Tuple[Callable, Callable]]`, *optional*):
            Dictionary of custom types and their encoders/decoders. Used to encode/decode arguments that are not
            jsonable by default. E.g dataclasses, argparse.Namespace, OmegaConf, etc.

    Example:

    ```python
    >>> from huggingface_hub import ModelHubMixin

    # Inherit from ModelHubMixin
    >>> class MyCustomModel(
    ...         ModelHubMixin,
    ...         library_name="my-library",
    ...         tags=["computer-vision"],
    ...         repo_url="https://github.com/huggingface/my-cool-library",
    ...         paper_url="https://arxiv.org/abs/2304.12244",
    ...         docs_url="https://huggingface.co/docs/my-cool-library",
    ...         # ^ optional metadata to generate model card
    ...     ):
    ...     def __init__(self, size: int = 512, device: str = "cpu"):
    ...         # define how to initialize your model
    ...         super().__init__()
    ...         ...
    ...
    ...     def _save_pretrained(self, save_directory: Path) -> None:
    ...         # define how to serialize your model
    ...         ...
    ...
    ...     @classmethod
    ...     def from_pretrained(
    ...         cls: Type[T],
    ...         pretrained_model_name_or_path: Union[str, Path],
    ...         *,
    ...         force_download: bool = False,
    ...         resume_download: Optional[bool] = None,
    ...         proxies: Optional[Dict] = None,
    ...         token: Optional[Union[str, bool]] = None,
    ...         cache_dir: Optional[Union[str, Path]] = None,
    ...         local_files_only: bool = False,
    ...         revision: Optional[str] = None,
    ...         **model_kwargs,
    ...     ) -> T:
    ...         # define how to deserialize your model
    ...         ...

    >>> model = MyCustomModel(size=256, device="gpu")

    # Save model weights to local directory
    >>> model.save_pretrained("my-awesome-model")

    # Push model weights to the Hub
    >>> model.push_to_hub("my-awesome-model")

    # Download and initialize weights from the Hub
    >>> reloaded_model = MyCustomModel.from_pretrained("username/my-awesome-model")
    >>> reloaded_model.size
    256

    # Model card has been correctly populated
    >>> from huggingface_hub import ModelCard
    >>> card = ModelCard.load("username/my-awesome-model")
    >>> card.data.tags
    ["x-custom-tag", "pytorch_model_hub_mixin", "model_hub_mixin"]
    >>> card.data.library_name
    "my-library"
    ```
    """

    _hub_mixin_config: Optional[Union[dict, DataclassInstance]] = None
    # ^ optional config attribute automatically set in `from_pretrained`
    _hub_mixin_info: MixinInfo
    # ^ information about the library integrating ModelHubMixin (used to generate model card)
    _hub_mixin_inject_config: bool  # whether `_from_pretrained` expects `config` or not
    _hub_mixin_init_parameters: Dict[str, inspect.Parameter]  # __init__ parameters
    _hub_mixin_jsonable_default_values: Dict[str, Any]  # default values for __init__ parameters
    _hub_mixin_jsonable_custom_types: Tuple[Type, ...]  # custom types that can be encoded/decoded
    _hub_mixin_coders: Dict[Type, CODER_T]  # encoders/decoders for custom types
    # ^ internal values to handle config

    def __init_subclass__(
        cls,
        *,
        # Generic info for model card
        repo_url: Optional[str] = None,
        paper_url: Optional[str] = None,
        docs_url: Optional[str] = None,
        # Model card template
        model_card_template: str = DEFAULT_MODEL_CARD,
        # Model card metadata
        language: Optional[List[str]] = None,
        library_name: Optional[str] = None,
        license: Optional[str] = None,
        license_name: Optional[str] = None,
        license_link: Optional[str] = None,
        pipeline_tag: Optional[str] = None,
        tags: Optional[List[str]] = None,
        # How to encode/decode arguments with custom type into a JSON config?
        coders: Optional[
            Dict[Type, CODER_T]
            # Key is a type.
            # Value is a tuple (encoder, decoder).
            # Example: {MyCustomType: (lambda x: x.value, lambda data: MyCustomType(data))}
        ] = None,
    ) -> None:
        """Inspect __init__ signature only once when subclassing + handle modelcard."""
        super().__init_subclass__()

        # Will be reused when creating modelcard
        tags = tags or []
        tags.append("model_hub_mixin")

        # Initialize MixinInfo if not existent
        info = MixinInfo(model_card_template=model_card_template, model_card_data=ModelCardData())

        # If parent class has a MixinInfo, inherit from it as a copy
        if hasattr(cls, "_hub_mixin_info"):
            # Inherit model card template from parent class if not explicitly set
            if model_card_template == DEFAULT_MODEL_CARD:
                info.model_card_template = cls._hub_mixin_info.model_card_template

            # Inherit from parent model card data
            info.model_card_data = ModelCardData(**cls._hub_mixin_info.model_card_data.to_dict())

            # Inherit other info
            info.docs_url = cls._hub_mixin_info.docs_url
            info.paper_url = cls._hub_mixin_info.paper_url
            info.repo_url = cls._hub_mixin_info.repo_url
        cls._hub_mixin_info = info

        # Update MixinInfo with metadata
        if model_card_template is not None and model_card_template != DEFAULT_MODEL_CARD:
            info.model_card_template = model_card_template
        if repo_url is not None:
            info.repo_url = repo_url
        if paper_url is not None:
            info.paper_url = paper_url
        if docs_url is not None:
            info.docs_url = docs_url
        if language is not None:
            info.model_card_data.language = language
        if library_name is not None:
            info.model_card_data.library_name = library_name
        if license is not None:
            info.model_card_data.license = license
        if license_name is not None:
            info.model_card_data.license_name = license_name
        if license_link is not None:
            info.model_card_data.license_link = license_link
        if pipeline_tag is not None:
            info.model_card_data.pipeline_tag = pipeline_tag
        if tags is not None:
            if info.model_card_data.tags is not None:
                info.model_card_data.tags.extend(tags)
            else:
                info.model_card_data.tags = tags

        info.model_card_data.tags = sorted(set(info.model_card_data.tags))

        # Handle encoders/decoders for args
        cls._hub_mixin_coders = coders or {}
        cls._hub_mixin_jsonable_custom_types = tuple(cls._hub_mixin_coders.keys())

        # Inspect __init__ signature to handle config
        cls._hub_mixin_init_parameters = dict(inspect.signature(cls.__init__).parameters)
        cls._hub_mixin_jsonable_default_values = {
            param.name: cls._encode_arg(param.default)
            for param in cls._hub_mixin_init_parameters.values()
            if param.default is not inspect.Parameter.empty and cls._is_jsonable(param.default)
        }
        cls._hub_mixin_inject_config = "config" in inspect.signature(cls._from_pretrained).parameters

    def __new__(cls: Type[T], *args, **kwargs) -> T:
        """Create a new instance of the class and handle config.

        3 cases:
        - If `self._hub_mixin_config` is already set, do nothing.
        - If `config` is passed as a dataclass, set it as `self._hub_mixin_config`.
        - Otherwise, build `self._hub_mixin_config` from default values and passed values.
        """
        instance = super().__new__(cls)

        # If `config` is already set, return early
        if instance._hub_mixin_config is not None:
            return instance

        # Infer passed values
        passed_values = {
            **{
                key: value
                for key, value in zip(
                    # [1:] to skip `self` parameter
                    list(cls._hub_mixin_init_parameters)[1:],
                    args,
                )
            },
            **kwargs,
        }

        # If config passed as dataclass => set it and return early
        if is_dataclass(passed_values.get("config")):
            instance._hub_mixin_config = passed_values["config"]
            return instance

        # Otherwise, build config from default + passed values
        init_config = {
            # default values
            **cls._hub_mixin_jsonable_default_values,
            # passed values
            **{
                key: cls._encode_arg(value)  # Encode custom types as jsonable value
                for key, value in passed_values.items()
                if instance._is_jsonable(value)  # Only if jsonable or we have a custom encoder
            },
        }
        passed_config = init_config.pop("config", {})

        # Populate `init_config` with provided config
        if isinstance(passed_config, dict):
            init_config.update(passed_config)

        # Set `config` attribute and return
        if init_config != {}:
            instance._hub_mixin_config = init_config
        return instance

    @classmethod
    def _is_jsonable(cls, value: Any) -> bool:
        """Check if a value is JSON serializable."""
        if is_dataclass(value):
            return True
        if isinstance(value, cls._hub_mixin_jsonable_custom_types):
            return True
        return is_jsonable(value)

    @classmethod
    def _encode_arg(cls, arg: Any) -> Any:
        """Encode an argument into a JSON serializable format."""
        if is_dataclass(arg):
            return asdict(arg)  # type: ignore[arg-type]
        for type_, (encoder, _) in cls._hub_mixin_coders.items():
            if isinstance(arg, type_):
                if arg is None:
                    return None
                return encoder(arg)
        return arg

    @classmethod
    def _decode_arg(cls, expected_type: Type[ARGS_T], value: Any) -> Optional[ARGS_T]:
        """Decode a JSON serializable value into an argument."""
        if is_simple_optional_type(expected_type):
            if value is None:
                return None
            expected_type = unwrap_simple_optional_type(expected_type)
        # Dataclass => handle it
        if is_dataclass(expected_type):
            return _load_dataclass(expected_type, value)  # type: ignore[return-value]
        # Otherwise => check custom decoders
        for type_, (_, decoder) in cls._hub_mixin_coders.items():
            if inspect.isclass(expected_type) and issubclass(expected_type, type_):
                return decoder(value)
        # Otherwise => don't decode
        return value

    def save_pretrained(
        self,
        save_directory: Union[str, Path],
        *,
        config: Optional[Union[dict, DataclassInstance]] = None,
        repo_id: Optional[str] = None,
        push_to_hub: bool = False,
        model_card_kwargs: Optional[Dict[str, Any]] = None,
        **push_to_hub_kwargs,
    ) -> Optional[str]:
        """
        Save weights in local directory.

        Args:
            save_directory (`str` or `Path`):
                Path to directory in which the model weights and configuration will be saved.
            config (`dict` or `DataclassInstance`, *optional*):
                Model configuration specified as a key/value dictionary or a dataclass instance.
            push_to_hub (`bool`, *optional*, defaults to `False`):
                Whether or not to push your model to the Huggingface Hub after saving it.
            repo_id (`str`, *optional*):
                ID of your repository on the Hub. Used only if `push_to_hub=True`. Will default to the folder name if
                not provided.
            model_card_kwargs (`Dict[str, Any]`, *optional*):
                Additional arguments passed to the model card template to customize the model card.
            push_to_hub_kwargs:
                Additional key word arguments passed along to the [`~ModelHubMixin.push_to_hub`] method.
        Returns:
            `str` or `None`: url of the commit on the Hub if `push_to_hub=True`, `None` otherwise.
        """
        save_directory = Path(save_directory)
        save_directory.mkdir(parents=True, exist_ok=True)

        # Remove config.json if already exists. After `_save_pretrained` we don't want to overwrite config.json
        # as it might have been saved by the custom `_save_pretrained` already. However we do want to overwrite
        # an existing config.json if it was not saved by `_save_pretrained`.
        config_path = save_directory / constants.CONFIG_NAME
        config_path.unlink(missing_ok=True)

        # save model weights/files (framework-specific)
        self._save_pretrained(save_directory)

        # save config (if provided and if not serialized yet in `_save_pretrained`)
        if config is None:
            config = self._hub_mixin_config
        if config is not None:
            if is_dataclass(config):
                config = asdict(config)  # type: ignore[arg-type]
            if not config_path.exists():
                config_str = json.dumps(config, sort_keys=True, indent=2)
                config_path.write_text(config_str)

        # save model card
        model_card_path = save_directory / "README.md"
        model_card_kwargs = model_card_kwargs if model_card_kwargs is not None else {}
        if not model_card_path.exists():  # do not overwrite if already exists
            self.generate_model_card(**model_card_kwargs).save(save_directory / "README.md")

        # push to the Hub if required
        if push_to_hub:
            kwargs = push_to_hub_kwargs.copy()  # soft-copy to avoid mutating input
            if config is not None:  # kwarg for `push_to_hub`
                kwargs["config"] = config
            if repo_id is None:
                repo_id = save_directory.name  # Defaults to `save_directory` name
            return self.push_to_hub(repo_id=repo_id, model_card_kwargs=model_card_kwargs, **kwargs)
        return None

    def _save_pretrained(self, save_directory: Path) -> None:
        """
        Overwrite this method in subclass to define how to save your model.
        Check out our [integration guide](../guides/integrations) for instructions.

        Args:
            save_directory (`str` or `Path`):
                Path to directory in which the model weights and configuration will be saved.
        """
        raise NotImplementedError

    @classmethod
    @validate_hf_hub_args
    def from_pretrained(
        cls: Type[T],
        pretrained_model_name_or_path: Union[str, Path],
        *,
        force_download: bool = False,
        resume_download: Optional[bool] = None,
        proxies: Optional[Dict] = None,
        token: Optional[Union[str, bool]] = None,
        cache_dir: Optional[Union[str, Path]] = None,
        local_files_only: bool = False,
        revision: Optional[str] = None,
        **model_kwargs,
    ) -> T:
        """
        Download a model from the Huggingface Hub and instantiate it.

        Args:
            pretrained_model_name_or_path (`str`, `Path`):
                - Either the `model_id` (string) of a model hosted on the Hub, e.g. `bigscience/bloom`.
                - Or a path to a `directory` containing model weights saved using
                    [`~transformers.PreTrainedModel.save_pretrained`], e.g., `../path/to/my_model_directory/`.
            revision (`str`, *optional*):
                Revision of the model on the Hub. Can be a branch name, a git tag or any commit id.
                Defaults to the latest commit on `main` branch.
            force_download (`bool`, *optional*, defaults to `False`):
                Whether to force (re-)downloading the model weights and configuration files from the Hub, overriding
                the existing cache.
            proxies (`Dict[str, str]`, *optional*):
                A dictionary of proxy servers to use by protocol or endpoint, e.g., `{'http': 'foo.bar:3128',
                'http://hostname': 'foo.bar:4012'}`. The proxies are used on every request.
            token (`str` or `bool`, *optional*):
                The token to use as HTTP bearer authorization for remote files. By default, it will use the token
                cached when running `huggingface-cli login`.
            cache_dir (`str`, `Path`, *optional*):
                Path to the folder where cached files are stored.
            local_files_only (`bool`, *optional*, defaults to `False`):
                If `True`, avoid downloading the file and return the path to the local cached file if it exists.
            model_kwargs (`Dict`, *optional*):
                Additional kwargs to pass to the model during initialization.
        """
        model_id = str(pretrained_model_name_or_path)
        config_file: Optional[str] = None
        if os.path.isdir(model_id):
            if constants.CONFIG_NAME in os.listdir(model_id):
                config_file = os.path.join(model_id, constants.CONFIG_NAME)
            else:
                logger.warning(f"{constants.CONFIG_NAME} not found in {Path(model_id).resolve()}")
        else:
            try:
                config_file = hf_hub_download(
                    repo_id=model_id,
                    filename=constants.CONFIG_NAME,
                    revision=revision,
                    cache_dir=cache_dir,
                    force_download=force_download,
                    proxies=proxies,
                    resume_download=resume_download,
                    token=token,
                    local_files_only=local_files_only,
                )
            except HfHubHTTPError as e:
                logger.info(f"{constants.CONFIG_NAME} not found on the HuggingFace Hub: {str(e)}")

        # Read config
        config = None
        if config_file is not None:
            with open(config_file, "r", encoding="utf-8") as f:
                config = json.load(f)

            # Decode custom types in config
            for key, value in config.items():
                if key in cls._hub_mixin_init_parameters:
                    expected_type = cls._hub_mixin_init_parameters[key].annotation
                    if expected_type is not inspect.Parameter.empty:
                        config[key] = cls._decode_arg(expected_type, value)

            # Populate model_kwargs from config
            for param in cls._hub_mixin_init_parameters.values():
                if param.name not in model_kwargs and param.name in config:
                    model_kwargs[param.name] = config[param.name]

            # Check if `config` argument was passed at init
            if "config" in cls._hub_mixin_init_parameters and "config" not in model_kwargs:
                # Decode `config` argument if it was passed
                config_annotation = cls._hub_mixin_init_parameters["config"].annotation
                config = cls._decode_arg(config_annotation, config)

                # Forward config to model initialization
                model_kwargs["config"] = config

            # Inject config if `**kwargs` are expected
            if is_dataclass(cls):
                for key in cls.__dataclass_fields__:
                    if key not in model_kwargs and key in config:
                        model_kwargs[key] = config[key]
            elif any(param.kind == inspect.Parameter.VAR_KEYWORD for param in cls._hub_mixin_init_parameters.values()):
                for key, value in config.items():
                    if key not in model_kwargs:
                        model_kwargs[key] = value

            # Finally, also inject if `_from_pretrained` expects it
            if cls._hub_mixin_inject_config and "config" not in model_kwargs:
                model_kwargs["config"] = config

        instance = cls._from_pretrained(
            model_id=str(model_id),
            revision=revision,
            cache_dir=cache_dir,
            force_download=force_download,
            proxies=proxies,
            resume_download=resume_download,
            local_files_only=local_files_only,
            token=token,
            **model_kwargs,
        )

        # Implicitly set the config as instance attribute if not already set by the class
        # This way `config` will be available when calling `save_pretrained` or `push_to_hub`.
        if config is not None and (getattr(instance, "_hub_mixin_config", None) in (None, {})):
            instance._hub_mixin_config = config

        return instance

    @classmethod
    def _from_pretrained(
        cls: Type[T],
        *,
        model_id: str,
        revision: Optional[str],
        cache_dir: Optional[Union[str, Path]],
        force_download: bool,
        proxies: Optional[Dict],
        resume_download: Optional[bool],
        local_files_only: bool,
        token: Optional[Union[str, bool]],
        **model_kwargs,
    ) -> T:
        """Overwrite this method in subclass to define how to load your model from pretrained.

        Use [`hf_hub_download`] or [`snapshot_download`] to download files from the Hub before loading them. Most
        args taken as input can be directly passed to those 2 methods. If needed, you can add more arguments to this
        method using "model_kwargs". For example [`PyTorchModelHubMixin._from_pretrained`] takes as input a `map_location`
        parameter to set on which device the model should be loaded.

        Check out our [integration guide](../guides/integrations) for more instructions.

        Args:
            model_id (`str`):
                ID of the model to load from the Huggingface Hub (e.g. `bigscience/bloom`).
            revision (`str`, *optional*):
                Revision of the model on the Hub. Can be a branch name, a git tag or any commit id. Defaults to the
                latest commit on `main` branch.
            force_download (`bool`, *optional*, defaults to `False`):
                Whether to force (re-)downloading the model weights and configuration files from the Hub, overriding
                the existing cache.
            proxies (`Dict[str, str]`, *optional*):
                A dictionary of proxy servers to use by protocol or endpoint (e.g., `{'http': 'foo.bar:3128',
                'http://hostname': 'foo.bar:4012'}`).
            token (`str` or `bool`, *optional*):
                The token to use as HTTP bearer authorization for remote files. By default, it will use the token
                cached when running `huggingface-cli login`.
            cache_dir (`str`, `Path`, *optional*):
                Path to the folder where cached files are stored.
            local_files_only (`bool`, *optional*, defaults to `False`):
                If `True`, avoid downloading the file and return the path to the local cached file if it exists.
            model_kwargs:
                Additional keyword arguments passed along to the [`~ModelHubMixin._from_pretrained`] method.
        """
        raise NotImplementedError

    @validate_hf_hub_args
    def push_to_hub(
        self,
        repo_id: str,
        *,
        config: Optional[Union[dict, DataclassInstance]] = None,
        commit_message: str = "Push model using huggingface_hub.",
        private: Optional[bool] = None,
        token: Optional[str] = None,
        branch: Optional[str] = None,
        create_pr: Optional[bool] = None,
        allow_patterns: Optional[Union[List[str], str]] = None,
        ignore_patterns: Optional[Union[List[str], str]] = None,
        delete_patterns: Optional[Union[List[str], str]] = None,
        model_card_kwargs: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Upload model checkpoint to the Hub.

        Use `allow_patterns` and `ignore_patterns` to precisely filter which files should be pushed to the hub. Use
        `delete_patterns` to delete existing remote files in the same commit. See [`upload_folder`] reference for more
        details.

        Args:
            repo_id (`str`):
                ID of the repository to push to (example: `"username/my-model"`).
            config (`dict` or `DataclassInstance`, *optional*):
                Model configuration specified as a key/value dictionary or a dataclass instance.
            commit_message (`str`, *optional*):
                Message to commit while pushing.
            private (`bool`, *optional*):
                Whether the repository created should be private.
                If `None` (default), the repo will be public unless the organization's default is private.
            token (`str`, *optional*):
                The token to use as HTTP bearer authorization for remote files. By default, it will use the token
                cached when running `huggingface-cli login`.
            branch (`str`, *optional*):
                The git branch on which to push the model. This defaults to `"main"`.
            create_pr (`boolean`, *optional*):
                Whether or not to create a Pull Request from `branch` with that commit. Defaults to `False`.
            allow_patterns (`List[str]` or `str`, *optional*):
                If provided, only files matching at least one pattern are pushed.
            ignore_patterns (`List[str]` or `str`, *optional*):
                If provided, files matching any of the patterns are not pushed.
            delete_patterns (`List[str]` or `str`, *optional*):
                If provided, remote files matching any of the patterns will be deleted from the repo.
            model_card_kwargs (`Dict[str, Any]`, *optional*):
                Additional arguments passed to the model card template to customize the model card.

        Returns:
            The url of the commit of your model in the given repository.
        """
        api = HfApi(token=token)
        repo_id = api.create_repo(repo_id=repo_id, private=private, exist_ok=True).repo_id

        # Push the files to the repo in a single commit
        with SoftTemporaryDirectory() as tmp:
            saved_path = Path(tmp) / repo_id
            self.save_pretrained(saved_path, config=config, model_card_kwargs=model_card_kwargs)
            return api.upload_folder(
                repo_id=repo_id,
                repo_type="model",
                folder_path=saved_path,
                commit_message=commit_message,
                revision=branch,
                create_pr=create_pr,
                allow_patterns=allow_patterns,
                ignore_patterns=ignore_patterns,
                delete_patterns=delete_patterns,
            )

    def generate_model_card(self, *args, **kwargs) -> ModelCard:
        card = ModelCard.from_template(
            card_data=self._hub_mixin_info.model_card_data,
            template_str=self._hub_mixin_info.model_card_template,
            repo_url=self._hub_mixin_info.repo_url,
            paper_url=self._hub_mixin_info.paper_url,
            docs_url=self._hub_mixin_info.docs_url,
            **kwargs,
        )
        return card


class PyTorchModelHubMixin(ModelHubMixin):
    """
    Implementation of [`ModelHubMixin`] to provide model Hub upload/download capabilities to PyTorch models. The model
    is set in evaluation mode by default using `model.eval()` (dropout modules are deactivated). To train the model,
    you should first set it back in training mode with `model.train()`.

    See [`ModelHubMixin`] for more details on how to use the mixin.

    Example:

    ```python
    >>> import torch
    >>> import torch.nn as nn
    >>> from huggingface_hub import PyTorchModelHubMixin

    >>> class MyModel(
    ...         nn.Module,
    ...         PyTorchModelHubMixin,
    ...         library_name="keras-nlp",
    ...         repo_url="https://github.com/keras-team/keras-nlp",
    ...         paper_url="https://arxiv.org/abs/2304.12244",
    ...         docs_url="https://keras.io/keras_nlp/",
    ...         # ^ optional metadata to generate model card
    ...     ):
    ...     def __init__(self, hidden_size: int = 512, vocab_size: int = 30000, output_size: int = 4):
    ...         super().__init__()
    ...         self.param = nn.Parameter(torch.rand(hidden_size, vocab_size))
    ...         self.linear = nn.Linear(output_size, vocab_size)

    ...     def forward(self, x):
    ...         return self.linear(x + self.param)
    >>> model = MyModel(hidden_size=256)

    # Save model weights to local directory
    >>> model.save_pretrained("my-awesome-model")

    # Push model weights to the Hub
    >>> model.push_to_hub("my-awesome-model")

    # Download and initialize weights from the Hub
    >>> model = MyModel.from_pretrained("username/my-awesome-model")
    >>> model.hidden_size
    256
    ```
    """

    def __init_subclass__(cls, *args, tags: Optional[List[str]] = None, **kwargs) -> None:
        tags = tags or []
        tags.append("pytorch_model_hub_mixin")
        kwargs["tags"] = tags
        return super().__init_subclass__(*args, **kwargs)

    def _save_pretrained(self, save_directory: Path) -> None:
        """Save weights from a Pytorch model to a local directory."""
        model_to_save = self.module if hasattr(self, "module") else self  # type: ignore
        save_model_as_safetensor(model_to_save, str(save_directory / constants.SAFETENSORS_SINGLE_FILE))  # type: ignore [arg-type]

    @classmethod
    def _from_pretrained(
        cls,
        *,
        model_id: str,
        revision: Optional[str],
        cache_dir: Optional[Union[str, Path]],
        force_download: bool,
        proxies: Optional[Dict],
        resume_download: Optional[bool],
        local_files_only: bool,
        token: Union[str, bool, None],
        map_location: str = "cpu",
        strict: bool = False,
        **model_kwargs,
    ):
        """Load Pytorch pretrained weights and return the loaded model."""
        model = cls(**model_kwargs)
        if os.path.isdir(model_id):
            print("Loading weights from local directory")
            model_file = os.path.join(model_id, constants.SAFETENSORS_SINGLE_FILE)
            return cls._load_as_safetensor(model, model_file, map_location, strict)
        else:
            try:
                model_file = hf_hub_download(
                    repo_id=model_id,
                    filename=constants.SAFETENSORS_SINGLE_FILE,
                    revision=revision,
                    cache_dir=cache_dir,
                    force_download=force_download,
                    proxies=proxies,
                    resume_download=resume_download,
                    token=token,
                    local_files_only=local_files_only,
                )
                return cls._load_as_safetensor(model, model_file, map_location, strict)
            except EntryNotFoundError:
                model_file = hf_hub_download(
                    repo_id=model_id,
                    filename=constants.PYTORCH_WEIGHTS_NAME,
                    revision=revision,
                    cache_dir=cache_dir,
                    force_download=force_download,
                    proxies=proxies,
                    resume_download=resume_download,
                    token=token,
                    local_files_only=local_files_only,
                )
                return cls._load_as_pickle(model, model_file, map_location, strict)

    @classmethod
    def _load_as_pickle(cls, model: T, model_file: str, map_location: str, strict: bool) -> T:
        state_dict = torch.load(model_file, map_location=torch.device(map_location), weights_only=True)
        model.load_state_dict(state_dict, strict=strict)  # type: ignore
        model.eval()  # type: ignore
        return model

    @classmethod
    def _load_as_safetensor(cls, model: T, model_file: str, map_location: str, strict: bool) -> T:
        if packaging.version.parse(safetensors.__version__) < packaging.version.parse("0.4.3"):  # type: ignore [attr-defined]
            load_model_as_safetensor(model, model_file, strict=strict)  # type: ignore [arg-type]
            if map_location != "cpu":
                logger.warning(
                    "Loading model weights on other devices than 'cpu' is not supported natively in your version of safetensors."
                    " This means that the model is loaded on 'cpu' first and then copied to the device."
                    " This leads to a slower loading time."
                    " Please update safetensors to version 0.4.3 or above for improved performance."
                )
                model.to(map_location)  # type: ignore [attr-defined]
        else:
            safetensors.torch.load_model(model, model_file, strict=strict, device=map_location)  # type: ignore [arg-type]
        return model


def _load_dataclass(datacls: Type[DataclassInstance], data: dict) -> DataclassInstance:
    """Load a dataclass instance from a dictionary.

    Fields not expected by the dataclass are ignored.
    """
    return datacls(**{k: v for k, v in data.items() if k in datacls.__dataclass_fields__})
