import collections.abc as collections
import json
import os
import warnings
from functools import wraps
from pathlib import Path
from shutil import copytree
from typing import Any, Dict, List, Optional, Union

from huggingface_hub import ModelHubMixin, snapshot_download
from huggingface_hub.utils import (
    get_tf_version,
    is_graphviz_available,
    is_pydot_available,
    is_tf_available,
    yaml_dump,
)

from . import constants
from .hf_api import HfApi
from .utils import SoftTemporaryDirectory, logging, validate_hf_hub_args
from .utils._typing import CallableT


logger = logging.get_logger(__name__)

keras = None
if is_tf_available():
    # Depending on which version of TensorFlow is installed, we need to import
    # keras from the correct location.
    # See https://github.com/tensorflow/tensorflow/releases/tag/v2.16.1.
    # Note: saving a keras model only works with Keras<3.0.
    try:
        import tf_keras as keras  # type: ignore
    except ImportError:
        import tensorflow as tf  # type: ignore

        keras = tf.keras


def _requires_keras_2_model(fn: CallableT) -> CallableT:
    # Wrapper to raise if user tries to save a Keras 3.x model
    @wraps(fn)
    def _inner(model, *args, **kwargs):
        if not hasattr(model, "history"):  # hacky way to check if model is Keras 2.x
            raise NotImplementedError(
                f"Cannot use '{fn.__name__}': Keras 3.x is not supported."
                " Please save models manually and upload them using `upload_folder` or `huggingface-cli upload`."
            )
        return fn(model, *args, **kwargs)

    return _inner  # type: ignore [return-value]


def _flatten_dict(dictionary, parent_key=""):
    """Flatten a nested dictionary.
    Reference: https://stackoverflow.com/a/6027615/10319735

    Args:
        dictionary (`dict`):
            The nested dictionary to be flattened.
        parent_key (`str`):
            The parent key to be prefixed to the children keys.
            Necessary for recursing over the nested dictionary.

    Returns:
        The flattened dictionary.
    """
    items = []
    for key, value in dictionary.items():
        new_key = f"{parent_key}.{key}" if parent_key else key
        if isinstance(value, collections.MutableMapping):
            items.extend(
                _flatten_dict(
                    value,
                    new_key,
                ).items()
            )
        else:
            items.append((new_key, value))
    return dict(items)


def _create_hyperparameter_table(model):
    """Parse hyperparameter dictionary into a markdown table."""
    table = None
    if model.optimizer is not None:
        optimizer_params = model.optimizer.get_config()
        # flatten the configuration
        optimizer_params = _flatten_dict(optimizer_params)
        optimizer_params["training_precision"] = keras.mixed_precision.global_policy().name
        table = "| Hyperparameters | Value |\n| :-- | :-- |\n"
        for key, value in optimizer_params.items():
            table += f"| {key} | {value} |\n"
    return table


def _plot_network(model, save_directory):
    keras.utils.plot_model(
        model,
        to_file=f"{save_directory}/model.png",
        show_shapes=False,
        show_dtype=False,
        show_layer_names=True,
        rankdir="TB",
        expand_nested=False,
        dpi=96,
        layer_range=None,
    )


def _create_model_card(
    model,
    repo_dir: Path,
    plot_model: bool = True,
    metadata: Optional[dict] = None,
):
    """
    Creates a model card for the repository.

    Do not overwrite an existing README.md file.
    """
    readme_path = repo_dir / "README.md"
    if readme_path.exists():
        return

    hyperparameters = _create_hyperparameter_table(model)
    if plot_model and is_graphviz_available() and is_pydot_available():
        _plot_network(model, repo_dir)
    if metadata is None:
        metadata = {}
    metadata["library_name"] = "keras"
    model_card: str = "---\n"
    model_card += yaml_dump(metadata, default_flow_style=False)
    model_card += "---\n"
    model_card += "\n## Model description\n\nMore information needed\n"
    model_card += "\n## Intended uses & limitations\n\nMore information needed\n"
    model_card += "\n## Training and evaluation data\n\nMore information needed\n"
    if hyperparameters is not None:
        model_card += "\n## Training procedure\n"
        model_card += "\n### Training hyperparameters\n"
        model_card += "\nThe following hyperparameters were used during training:\n\n"
        model_card += hyperparameters
        model_card += "\n"
    if plot_model and os.path.exists(f"{repo_dir}/model.png"):
        model_card += "\n ## Model Plot\n"
        model_card += "\n<details>"
        model_card += "\n<summary>View Model Plot</summary>\n"
        path_to_plot = "./model.png"
        model_card += f"\n![Model Image]({path_to_plot})\n"
        model_card += "\n</details>"

    readme_path.write_text(model_card)


@_requires_keras_2_model
def save_pretrained_keras(
    model,
    save_directory: Union[str, Path],
    config: Optional[Dict[str, Any]] = None,
    include_optimizer: bool = False,
    plot_model: bool = True,
    tags: Optional[Union[list, str]] = None,
    **model_save_kwargs,
):
    """
    Saves a Keras model to save_directory in SavedModel format. Use this if
    you're using the Functional or Sequential APIs.

    Args:
        model (`Keras.Model`):
            The [Keras
            model](https://www.tensorflow.org/api_docs/python/tf/keras/Model)
            you'd like to save. The model must be compiled and built.
        save_directory (`str` or `Path`):
            Specify directory in which you want to save the Keras model.
        config (`dict`, *optional*):
            Configuration object to be saved alongside the model weights.
        include_optimizer(`bool`, *optional*, defaults to `False`):
            Whether or not to include optimizer in serialization.
        plot_model (`bool`, *optional*, defaults to `True`):
            Setting this to `True` will plot the model and put it in the model
            card. Requires graphviz and pydot to be installed.
        tags (Union[`str`,`list`], *optional*):
            List of tags that are related to model or string of a single tag. See example tags
            [here](https://github.com/huggingface/hub-docs/blob/main/modelcard.md?plain=1).
        model_save_kwargs(`dict`, *optional*):
            model_save_kwargs will be passed to
            [`tf.keras.models.save_model()`](https://www.tensorflow.org/api_docs/python/tf/keras/models/save_model).
    """
    if keras is None:
        raise ImportError("Called a Tensorflow-specific function but could not import it.")

    if not model.built:
        raise ValueError("Model should be built before trying to save")

    save_directory = Path(save_directory)
    save_directory.mkdir(parents=True, exist_ok=True)

    # saving config
    if config:
        if not isinstance(config, dict):
            raise RuntimeError(f"Provided config to save_pretrained_keras should be a dict. Got: '{type(config)}'")

        with (save_directory / constants.CONFIG_NAME).open("w") as f:
            json.dump(config, f)

    metadata = {}
    if isinstance(tags, list):
        metadata["tags"] = tags
    elif isinstance(tags, str):
        metadata["tags"] = [tags]

    task_name = model_save_kwargs.pop("task_name", None)
    if task_name is not None:
        warnings.warn(
            "`task_name` input argument is deprecated. Pass `tags` instead.",
            FutureWarning,
        )
        if "tags" in metadata:
            metadata["tags"].append(task_name)
        else:
            metadata["tags"] = [task_name]

    if model.history is not None:
        if model.history.history != {}:
            path = save_directory / "history.json"
            if path.exists():
                warnings.warn(
                    "`history.json` file already exists, it will be overwritten by the history of this version.",
                    UserWarning,
                )
            with path.open("w", encoding="utf-8") as f:
                json.dump(model.history.history, f, indent=2, sort_keys=True)

    _create_model_card(model, save_directory, plot_model, metadata)
    keras.models.save_model(model, save_directory, include_optimizer=include_optimizer, **model_save_kwargs)


def from_pretrained_keras(*args, **kwargs) -> "KerasModelHubMixin":
    r"""
    Instantiate a pretrained Keras model from a pre-trained model from the Hub.
    The model is expected to be in `SavedModel` format.

    Args:
        pretrained_model_name_or_path (`str` or `os.PathLike`):
            Can be either:
                - A string, the `model id` of a pretrained model hosted inside a
                  model repo on huggingface.co. Valid model ids can be located
                  at the root-level, like `bert-base-uncased`, or namespaced
                  under a user or organization name, like
                  `dbmdz/bert-base-german-cased`.
                - You can add `revision` by appending `@` at the end of model_id
                  simply like this: `dbmdz/bert-base-german-cased@main` Revision
                  is the specific model version to use. It can be a branch name,
                  a tag name, or a commit id, since we use a git-based system
                  for storing models and other artifacts on huggingface.co, so
                  `revision` can be any identifier allowed by git.
                - A path to a `directory` containing model weights saved using
                  [`~transformers.PreTrainedModel.save_pretrained`], e.g.,
                  `./my_model_directory/`.
                - `None` if you are both providing the configuration and state
                  dictionary (resp. with keyword arguments `config` and
                  `state_dict`).
        force_download (`bool`, *optional*, defaults to `False`):
            Whether to force the (re-)download of the model weights and
            configuration files, overriding the cached versions if they exist.
        proxies (`Dict[str, str]`, *optional*):
            A dictionary of proxy servers to use by protocol or endpoint, e.g.,
            `{'http': 'foo.bar:3128', 'http://hostname': 'foo.bar:4012'}`. The
            proxies are used on each request.
        token (`str` or `bool`, *optional*):
            The token to use as HTTP bearer authorization for remote files. If
            `True`, will use the token generated when running `transformers-cli
            login` (stored in `~/.huggingface`).
        cache_dir (`Union[str, os.PathLike]`, *optional*):
            Path to a directory in which a downloaded pretrained model
            configuration should be cached if the standard cache should not be
            used.
        local_files_only(`bool`, *optional*, defaults to `False`):
            Whether to only look at local files (i.e., do not try to download
            the model).
        model_kwargs (`Dict`, *optional*):
            model_kwargs will be passed to the model during initialization

    <Tip>

    Passing `token=True` is required when you want to use a private
    model.

    </Tip>
    """
    return KerasModelHubMixin.from_pretrained(*args, **kwargs)


@validate_hf_hub_args
@_requires_keras_2_model
def push_to_hub_keras(
    model,
    repo_id: str,
    *,
    config: Optional[dict] = None,
    commit_message: str = "Push Keras model using huggingface_hub.",
    private: Optional[bool] = None,
    api_endpoint: Optional[str] = None,
    token: Optional[str] = None,
    branch: Optional[str] = None,
    create_pr: Optional[bool] = None,
    allow_patterns: Optional[Union[List[str], str]] = None,
    ignore_patterns: Optional[Union[List[str], str]] = None,
    delete_patterns: Optional[Union[List[str], str]] = None,
    log_dir: Optional[str] = None,
    include_optimizer: bool = False,
    tags: Optional[Union[list, str]] = None,
    plot_model: bool = True,
    **model_save_kwargs,
):
    """
    Upload model checkpoint to the Hub.

    Use `allow_patterns` and `ignore_patterns` to precisely filter which files should be pushed to the hub. Use
    `delete_patterns` to delete existing remote files in the same commit. See [`upload_folder`] reference for more
    details.

    Args:
        model (`Keras.Model`):
            The [Keras model](`https://www.tensorflow.org/api_docs/python/tf/keras/Model`) you'd like to push to the
            Hub. The model must be compiled and built.
        repo_id (`str`):
                ID of the repository to push to (example: `"username/my-model"`).
        commit_message (`str`, *optional*, defaults to "Add Keras model"):
            Message to commit while pushing.
        private (`bool`, *optional*):
            Whether the repository created should be private.
            If `None` (default), the repo will be public unless the organization's default is private.
        api_endpoint (`str`, *optional*):
            The API endpoint to use when pushing the model to the hub.
        token (`str`, *optional*):
            The token to use as HTTP bearer authorization for remote files. If
            not set, will use the token set when logging in with
            `huggingface-cli login` (stored in `~/.huggingface`).
        branch (`str`, *optional*):
            The git branch on which to push the model. This defaults to
            the default branch as specified in your repository, which
            defaults to `"main"`.
        create_pr (`boolean`, *optional*):
            Whether or not to create a Pull Request from `branch` with that commit.
            Defaults to `False`.
        config (`dict`, *optional*):
            Configuration object to be saved alongside the model weights.
        allow_patterns (`List[str]` or `str`, *optional*):
            If provided, only files matching at least one pattern are pushed.
        ignore_patterns (`List[str]` or `str`, *optional*):
            If provided, files matching any of the patterns are not pushed.
        delete_patterns (`List[str]` or `str`, *optional*):
            If provided, remote files matching any of the patterns will be deleted from the repo.
        log_dir (`str`, *optional*):
            TensorBoard logging directory to be pushed. The Hub automatically
            hosts and displays a TensorBoard instance if log files are included
            in the repository.
        include_optimizer (`bool`, *optional*, defaults to `False`):
            Whether or not to include optimizer during serialization.
        tags (Union[`list`, `str`], *optional*):
            List of tags that are related to model or string of a single tag. See example tags
            [here](https://github.com/huggingface/hub-docs/blob/main/modelcard.md?plain=1).
        plot_model (`bool`, *optional*, defaults to `True`):
            Setting this to `True` will plot the model and put it in the model
            card. Requires graphviz and pydot to be installed.
        model_save_kwargs(`dict`, *optional*):
            model_save_kwargs will be passed to
            [`tf.keras.models.save_model()`](https://www.tensorflow.org/api_docs/python/tf/keras/models/save_model).

    Returns:
        The url of the commit of your model in the given repository.
    """
    api = HfApi(endpoint=api_endpoint)
    repo_id = api.create_repo(repo_id=repo_id, token=token, private=private, exist_ok=True).repo_id

    # Push the files to the repo in a single commit
    with SoftTemporaryDirectory() as tmp:
        saved_path = Path(tmp) / repo_id
        save_pretrained_keras(
            model,
            saved_path,
            config=config,
            include_optimizer=include_optimizer,
            tags=tags,
            plot_model=plot_model,
            **model_save_kwargs,
        )

        # If `log_dir` provided, delete remote logs and upload new ones
        if log_dir is not None:
            delete_patterns = (
                []
                if delete_patterns is None
                else (
                    [delete_patterns]  # convert `delete_patterns` to a list
                    if isinstance(delete_patterns, str)
                    else delete_patterns
                )
            )
            delete_patterns.append("logs/*")
            copytree(log_dir, saved_path / "logs")

        return api.upload_folder(
            repo_type="model",
            repo_id=repo_id,
            folder_path=saved_path,
            commit_message=commit_message,
            token=token,
            revision=branch,
            create_pr=create_pr,
            allow_patterns=allow_patterns,
            ignore_patterns=ignore_patterns,
            delete_patterns=delete_patterns,
        )


class KerasModelHubMixin(ModelHubMixin):
    """
    Implementation of [`ModelHubMixin`] to provide model Hub upload/download
    capabilities to Keras models.


    ```python
    >>> import tensorflow as tf
    >>> from huggingface_hub import KerasModelHubMixin


    >>> class MyModel(tf.keras.Model, KerasModelHubMixin):
    ...     def __init__(self, **kwargs):
    ...         super().__init__()
    ...         self.config = kwargs.pop("config", None)
    ...         self.dummy_inputs = ...
    ...         self.layer = ...

    ...     def call(self, *args):
    ...         return ...


    >>> # Initialize and compile the model as you normally would
    >>> model = MyModel()
    >>> model.compile(...)
    >>> # Build the graph by training it or passing dummy inputs
    >>> _ = model(model.dummy_inputs)
    >>> # Save model weights to local directory
    >>> model.save_pretrained("my-awesome-model")
    >>> # Push model weights to the Hub
    >>> model.push_to_hub("my-awesome-model")
    >>> # Download and initialize weights from the Hub
    >>> model = MyModel.from_pretrained("username/super-cool-model")
    ```
    """

    def _save_pretrained(self, save_directory):
        save_pretrained_keras(self, save_directory)

    @classmethod
    def _from_pretrained(
        cls,
        model_id,
        revision,
        cache_dir,
        force_download,
        proxies,
        resume_download,
        local_files_only,
        token,
        config: Optional[Dict[str, Any]] = None,
        **model_kwargs,
    ):
        """Here we just call [`from_pretrained_keras`] function so both the mixin and
        functional APIs stay in sync.

                TODO - Some args above aren't used since we are calling
                snapshot_download instead of hf_hub_download.
        """
        if keras is None:
            raise ImportError("Called a TensorFlow-specific function but could not import it.")

        # Root is either a local filepath matching model_id or a cached snapshot
        if not os.path.isdir(model_id):
            storage_folder = snapshot_download(
                repo_id=model_id,
                revision=revision,
                cache_dir=cache_dir,
                library_name="keras",
                library_version=get_tf_version(),
            )
        else:
            storage_folder = model_id

        # TODO: change this in a future PR. We are not returning a KerasModelHubMixin instance here...
        model = keras.models.load_model(storage_folder)

        # For now, we add a new attribute, config, to store the config loaded from the hub/a local dir.
        model.config = config

        return model
