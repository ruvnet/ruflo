import os
import re
from pathlib import Path
from typing import Any, Dict, Literal, Optional, Type, Union

import requests
import yaml

from huggingface_hub.file_download import hf_hub_download
from huggingface_hub.hf_api import upload_file
from huggingface_hub.repocard_data import (
    CardData,
    DatasetCardData,
    EvalResult,
    ModelCardData,
    SpaceCardData,
    eval_results_to_model_index,
    model_index_to_eval_results,
)
from huggingface_hub.utils import get_session, is_jinja_available, yaml_dump

from . import constants
from .errors import EntryNotFoundError
from .utils import SoftTemporaryDirectory, logging, validate_hf_hub_args


logger = logging.get_logger(__name__)


TEMPLATE_MODELCARD_PATH = Path(__file__).parent / "templates" / "modelcard_template.md"
TEMPLATE_DATASETCARD_PATH = Path(__file__).parent / "templates" / "datasetcard_template.md"

# exact same regex as in the Hub server. Please keep in sync.
# See https://github.com/huggingface/moon-landing/blob/main/server/lib/ViewMarkdown.ts#L18
REGEX_YAML_BLOCK = re.compile(r"^(\s*---[\r\n]+)([\S\s]*?)([\r\n]+---(\r\n|\n|$))")


class RepoCard:
    card_data_class = CardData
    default_template_path = TEMPLATE_MODELCARD_PATH
    repo_type = "model"

    def __init__(self, content: str, ignore_metadata_errors: bool = False):
        """Initialize a RepoCard from string content. The content should be a
        Markdown file with a YAML block at the beginning and a Markdown body.

        Args:
            content (`str`): The content of the Markdown file.

        Example:
            ```python
            >>> from huggingface_hub.repocard import RepoCard
            >>> text = '''
            ... ---
            ... language: en
            ... license: mit
            ... ---
            ...
            ... # My repo
            ... '''
            >>> card = RepoCard(text)
            >>> card.data.to_dict()
            {'language': 'en', 'license': 'mit'}
            >>> card.text
            '\\n# My repo\\n'

            ```
        <Tip>
        Raises the following error:

            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              when the content of the repo card metadata is not a dictionary.

        </Tip>
        """

        # Set the content of the RepoCard, as well as underlying .data and .text attributes.
        # See the `content` property setter for more details.
        self.ignore_metadata_errors = ignore_metadata_errors
        self.content = content

    @property
    def content(self):
        """The content of the RepoCard, including the YAML block and the Markdown body."""
        line_break = _detect_line_ending(self._content) or "\n"
        return f"---{line_break}{self.data.to_yaml(line_break=line_break, original_order=self._original_order)}{line_break}---{line_break}{self.text}"

    @content.setter
    def content(self, content: str):
        """Set the content of the RepoCard."""
        self._content = content

        match = REGEX_YAML_BLOCK.search(content)
        if match:
            # Metadata found in the YAML block
            yaml_block = match.group(2)
            self.text = content[match.end() :]
            data_dict = yaml.safe_load(yaml_block)

            if data_dict is None:
                data_dict = {}

            # The YAML block's data should be a dictionary
            if not isinstance(data_dict, dict):
                raise ValueError("repo card metadata block should be a dict")
        else:
            # Model card without metadata... create empty metadata
            logger.warning("Repo card metadata block was not found. Setting CardData to empty.")
            data_dict = {}
            self.text = content

        self.data = self.card_data_class(**data_dict, ignore_metadata_errors=self.ignore_metadata_errors)
        self._original_order = list(data_dict.keys())

    def __str__(self):
        return self.content

    def save(self, filepath: Union[Path, str]):
        r"""Save a RepoCard to a file.

        Args:
            filepath (`Union[Path, str]`): Filepath to the markdown file to save.

        Example:
            ```python
            >>> from huggingface_hub.repocard import RepoCard
            >>> card = RepoCard("---\nlanguage: en\n---\n# This is a test repo card")
            >>> card.save("/tmp/test.md")

            ```
        """
        filepath = Path(filepath)
        filepath.parent.mkdir(parents=True, exist_ok=True)
        # Preserve newlines as in the existing file.
        with open(filepath, mode="w", newline="", encoding="utf-8") as f:
            f.write(str(self))

    @classmethod
    def load(
        cls,
        repo_id_or_path: Union[str, Path],
        repo_type: Optional[str] = None,
        token: Optional[str] = None,
        ignore_metadata_errors: bool = False,
    ):
        """Initialize a RepoCard from a Hugging Face Hub repo's README.md or a local filepath.

        Args:
            repo_id_or_path (`Union[str, Path]`):
                The repo ID associated with a Hugging Face Hub repo or a local filepath.
            repo_type (`str`, *optional*):
                The type of Hugging Face repo to push to. Defaults to None, which will use use "model". Other options
                are "dataset" and "space". Not used when loading from a local filepath. If this is called from a child
                class, the default value will be the child class's `repo_type`.
            token (`str`, *optional*):
                Authentication token, obtained with `huggingface_hub.HfApi.login` method. Will default to the stored token.
            ignore_metadata_errors (`str`):
                If True, errors while parsing the metadata section will be ignored. Some information might be lost during
                the process. Use it at your own risk.

        Returns:
            [`huggingface_hub.repocard.RepoCard`]: The RepoCard (or subclass) initialized from the repo's
                README.md file or filepath.

        Example:
            ```python
            >>> from huggingface_hub.repocard import RepoCard
            >>> card = RepoCard.load("nateraw/food")
            >>> assert card.data.tags == ["generated_from_trainer", "image-classification", "pytorch"]

            ```
        """

        if Path(repo_id_or_path).is_file():
            card_path = Path(repo_id_or_path)
        elif isinstance(repo_id_or_path, str):
            card_path = Path(
                hf_hub_download(
                    repo_id_or_path,
                    constants.REPOCARD_NAME,
                    repo_type=repo_type or cls.repo_type,
                    token=token,
                )
            )
        else:
            raise ValueError(f"Cannot load RepoCard: path not found on disk ({repo_id_or_path}).")

        # Preserve newlines in the existing file.
        with card_path.open(mode="r", newline="", encoding="utf-8") as f:
            return cls(f.read(), ignore_metadata_errors=ignore_metadata_errors)

    def validate(self, repo_type: Optional[str] = None):
        """Validates card against Hugging Face Hub's card validation logic.
        Using this function requires access to the internet, so it is only called
        internally by [`huggingface_hub.repocard.RepoCard.push_to_hub`].

        Args:
            repo_type (`str`, *optional*, defaults to "model"):
                The type of Hugging Face repo to push to. Options are "model", "dataset", and "space".
                If this function is called from a child class, the default will be the child class's `repo_type`.

        <Tip>
        Raises the following errors:

            - [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
              if the card fails validation checks.
            - [`HTTPError`](https://requests.readthedocs.io/en/latest/api/#requests.HTTPError)
              if the request to the Hub API fails for any other reason.

        </Tip>
        """

        # If repo type is provided, otherwise, use the repo type of the card.
        repo_type = repo_type or self.repo_type

        body = {
            "repoType": repo_type,
            "content": str(self),
        }
        headers = {"Accept": "text/plain"}

        try:
            r = get_session().post("https://huggingface.co/api/validate-yaml", body, headers=headers)
            r.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            if r.status_code == 400:
                raise ValueError(r.text)
            else:
                raise exc

    def push_to_hub(
        self,
        repo_id: str,
        token: Optional[str] = None,
        repo_type: Optional[str] = None,
        commit_message: Optional[str] = None,
        commit_description: Optional[str] = None,
        revision: Optional[str] = None,
        create_pr: Optional[bool] = None,
        parent_commit: Optional[str] = None,
    ):
        """Push a RepoCard to a Hugging Face Hub repo.

        Args:
            repo_id (`str`):
                The repo ID of the Hugging Face Hub repo to push to. Example: "nateraw/food".
            token (`str`, *optional*):
                Authentication token, obtained with `huggingface_hub.HfApi.login` method. Will default to
                the stored token.
            repo_type (`str`, *optional*, defaults to "model"):
                The type of Hugging Face repo to push to. Options are "model", "dataset", and "space". If this
                function is called by a child class, it will default to the child class's `repo_type`.
            commit_message (`str`, *optional*):
                The summary / title / first line of the generated commit.
            commit_description (`str`, *optional*)
                The description of the generated commit.
            revision (`str`, *optional*):
                The git revision to commit from. Defaults to the head of the `"main"` branch.
            create_pr (`bool`, *optional*):
                Whether or not to create a Pull Request with this commit. Defaults to `False`.
            parent_commit (`str`, *optional*):
                The OID / SHA of the parent commit, as a hexadecimal string. Shorthands (7 first characters) are also supported.
                If specified and `create_pr` is `False`, the commit will fail if `revision` does not point to `parent_commit`.
                If specified and `create_pr` is `True`, the pull request will be created from `parent_commit`.
                Specifying `parent_commit` ensures the repo has not changed before committing the changes, and can be
                especially useful if the repo is updated / committed to concurrently.
        Returns:
            `str`: URL of the commit which updated the card metadata.
        """

        # If repo type is provided, otherwise, use the repo type of the card.
        repo_type = repo_type or self.repo_type

        # Validate card before pushing to hub
        self.validate(repo_type=repo_type)

        with SoftTemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir) / constants.REPOCARD_NAME
            tmp_path.write_text(str(self))
            url = upload_file(
                path_or_fileobj=str(tmp_path),
                path_in_repo=constants.REPOCARD_NAME,
                repo_id=repo_id,
                token=token,
                repo_type=repo_type,
                commit_message=commit_message,
                commit_description=commit_description,
                create_pr=create_pr,
                revision=revision,
                parent_commit=parent_commit,
            )
        return url

    @classmethod
    def from_template(
        cls,
        card_data: CardData,
        template_path: Optional[str] = None,
        template_str: Optional[str] = None,
        **template_kwargs,
    ):
        """Initialize a RepoCard from a template. By default, it uses the default template.

        Templates are Jinja2 templates that can be customized by passing keyword arguments.

        Args:
            card_data (`huggingface_hub.CardData`):
                A huggingface_hub.CardData instance containing the metadata you want to include in the YAML
                header of the repo card on the Hugging Face Hub.
            template_path (`str`, *optional*):
                A path to a markdown file with optional Jinja template variables that can be filled
                in with `template_kwargs`. Defaults to the default template.

        Returns:
            [`huggingface_hub.repocard.RepoCard`]: A RepoCard instance with the specified card data and content from the
            template.
        """
        if is_jinja_available():
            import jinja2
        else:
            raise ImportError(
                "Using RepoCard.from_template requires Jinja2 to be installed. Please"
                " install it with `pip install Jinja2`."
            )

        kwargs = card_data.to_dict().copy()
        kwargs.update(template_kwargs)  # Template_kwargs have priority

        if template_path is not None:
            template_str = Path(template_path).read_text()
        if template_str is None:
            template_str = Path(cls.default_template_path).read_text()
        template = jinja2.Template(template_str)
        content = template.render(card_data=card_data.to_yaml(), **kwargs)
        return cls(content)


class ModelCard(RepoCard):
    card_data_class = ModelCardData
    default_template_path = TEMPLATE_MODELCARD_PATH
    repo_type = "model"

    @classmethod
    def from_template(  # type: ignore # violates Liskov property but easier to use
        cls,
        card_data: ModelCardData,
        template_path: Optional[str] = None,
        template_str: Optional[str] = None,
        **template_kwargs,
    ):
        """Initialize a ModelCard from a template. By default, it uses the default template, which can be found here:
        https://github.com/huggingface/huggingface_hub/blob/main/src/huggingface_hub/templates/modelcard_template.md

        Templates are Jinja2 templates that can be customized by passing keyword arguments.

        Args:
            card_data (`huggingface_hub.ModelCardData`):
                A huggingface_hub.ModelCardData instance containing the metadata you want to include in the YAML
                header of the model card on the Hugging Face Hub.
            template_path (`str`, *optional*):
                A path to a markdown file with optional Jinja template variables that can be filled
                in with `template_kwargs`. Defaults to the default template.

        Returns:
            [`huggingface_hub.ModelCard`]: A ModelCard instance with the specified card data and content from the
            template.

        Example:
            ```python
            >>> from huggingface_hub import ModelCard, ModelCardData, EvalResult

            >>> # Using the Default Template
            >>> card_data = ModelCardData(
            ...     language='en',
            ...     license='mit',
            ...     library_name='timm',
            ...     tags=['image-classification', 'resnet'],
            ...     datasets=['beans'],
            ...     metrics=['accuracy'],
            ... )
            >>> card = ModelCard.from_template(
            ...     card_data,
            ...     model_description='This model does x + y...'
            ... )

            >>> # Including Evaluation Results
            >>> card_data = ModelCardData(
            ...     language='en',
            ...     tags=['image-classification', 'resnet'],
            ...     eval_results=[
            ...         EvalResult(
            ...             task_type='image-classification',
            ...             dataset_type='beans',
            ...             dataset_name='Beans',
            ...             metric_type='accuracy',
            ...             metric_value=0.9,
            ...         ),
            ...     ],
            ...     model_name='my-cool-model',
            ... )
            >>> card = ModelCard.from_template(card_data)

            >>> # Using a Custom Template
            >>> card_data = ModelCardData(
            ...     language='en',
            ...     tags=['image-classification', 'resnet']
            ... )
            >>> card = ModelCard.from_template(
            ...     card_data=card_data,
            ...     template_path='./src/huggingface_hub/templates/modelcard_template.md',
            ...     custom_template_var='custom value',  # will be replaced in template if it exists
            ... )

            ```
        """
        return super().from_template(card_data, template_path, template_str, **template_kwargs)


class DatasetCard(RepoCard):
    card_data_class = DatasetCardData
    default_template_path = TEMPLATE_DATASETCARD_PATH
    repo_type = "dataset"

    @classmethod
    def from_template(  # type: ignore # violates Liskov property but easier to use
        cls,
        card_data: DatasetCardData,
        template_path: Optional[str] = None,
        template_str: Optional[str] = None,
        **template_kwargs,
    ):
        """Initialize a DatasetCard from a template. By default, it uses the default template, which can be found here:
        https://github.com/huggingface/huggingface_hub/blob/main/src/huggingface_hub/templates/datasetcard_template.md

        Templates are Jinja2 templates that can be customized by passing keyword arguments.

        Args:
            card_data (`huggingface_hub.DatasetCardData`):
                A huggingface_hub.DatasetCardData instance containing the metadata you want to include in the YAML
                header of the dataset card on the Hugging Face Hub.
            template_path (`str`, *optional*):
                A path to a markdown file with optional Jinja template variables that can be filled
                in with `template_kwargs`. Defaults to the default template.

        Returns:
            [`huggingface_hub.DatasetCard`]: A DatasetCard instance with the specified card data and content from the
            template.

        Example:
            ```python
            >>> from huggingface_hub import DatasetCard, DatasetCardData

            >>> # Using the Default Template
            >>> card_data = DatasetCardData(
            ...     language='en',
            ...     license='mit',
            ...     annotations_creators='crowdsourced',
            ...     task_categories=['text-classification'],
            ...     task_ids=['sentiment-classification', 'text-scoring'],
            ...     multilinguality='monolingual',
            ...     pretty_name='My Text Classification Dataset',
            ... )
            >>> card = DatasetCard.from_template(
            ...     card_data,
            ...     pretty_name=card_data.pretty_name,
            ... )

            >>> # Using a Custom Template
            >>> card_data = DatasetCardData(
            ...     language='en',
            ...     license='mit',
            ... )
            >>> card = DatasetCard.from_template(
            ...     card_data=card_data,
            ...     template_path='./src/huggingface_hub/templates/datasetcard_template.md',
            ...     custom_template_var='custom value',  # will be replaced in template if it exists
            ... )

            ```
        """
        return super().from_template(card_data, template_path, template_str, **template_kwargs)


class SpaceCard(RepoCard):
    card_data_class = SpaceCardData
    default_template_path = TEMPLATE_MODELCARD_PATH
    repo_type = "space"


def _detect_line_ending(content: str) -> Literal["\r", "\n", "\r\n", None]:  # noqa: F722
    """Detect the line ending of a string. Used by RepoCard to avoid making huge diff on newlines.

    Uses same implementation as in Hub server, keep it in sync.

    Returns:
        str: The detected line ending of the string.
    """
    cr = content.count("\r")
    lf = content.count("\n")
    crlf = content.count("\r\n")
    if cr + lf == 0:
        return None
    if crlf == cr and crlf == lf:
        return "\r\n"
    if cr > lf:
        return "\r"
    else:
        return "\n"


def metadata_load(local_path: Union[str, Path]) -> Optional[Dict]:
    content = Path(local_path).read_text()
    match = REGEX_YAML_BLOCK.search(content)
    if match:
        yaml_block = match.group(2)
        data = yaml.safe_load(yaml_block)
        if data is None or isinstance(data, dict):
            return data
        raise ValueError("repo card metadata block should be a dict")
    else:
        return None


def metadata_save(local_path: Union[str, Path], data: Dict) -> None:
    """
    Save the metadata dict in the upper YAML part Trying to preserve newlines as
    in the existing file. Docs about open() with newline="" parameter:
    https://docs.python.org/3/library/functions.html?highlight=open#open Does
    not work with "^M" linebreaks, which are replaced by \n
    """
    line_break = "\n"
    content = ""
    # try to detect existing newline character
    if os.path.exists(local_path):
        with open(local_path, "r", newline="", encoding="utf8") as readme:
            content = readme.read()
            if isinstance(readme.newlines, tuple):
                line_break = readme.newlines[0]
            elif isinstance(readme.newlines, str):
                line_break = readme.newlines

    # creates a new file if it not
    with open(local_path, "w", newline="", encoding="utf8") as readme:
        data_yaml = yaml_dump(data, sort_keys=False, line_break=line_break)
        # sort_keys: keep dict order
        match = REGEX_YAML_BLOCK.search(content)
        if match:
            output = content[: match.start()] + f"---{line_break}{data_yaml}---{line_break}" + content[match.end() :]
        else:
            output = f"---{line_break}{data_yaml}---{line_break}{content}"

        readme.write(output)
        readme.close()


def metadata_eval_result(
    *,
    model_pretty_name: str,
    task_pretty_name: str,
    task_id: str,
    metrics_pretty_name: str,
    metrics_id: str,
    metrics_value: Any,
    dataset_pretty_name: str,
    dataset_id: str,
    metrics_config: Optional[str] = None,
    metrics_verified: bool = False,
    dataset_config: Optional[str] = None,
    dataset_split: Optional[str] = None,
    dataset_revision: Optional[str] = None,
    metrics_verification_token: Optional[str] = None,
) -> Dict:
    """
    Creates a metadata dict with the result from a model evaluated on a dataset.

    Args:
        model_pretty_name (`str`):
            The name of the model in natural language.
        task_pretty_name (`str`):
            The name of a task in natural language.
        task_id (`str`):
            Example: automatic-speech-recognition. A task id.
        metrics_pretty_name (`str`):
            A name for the metric in natural language. Example: Test WER.
        metrics_id (`str`):
            Example: wer. A metric id from https://hf.co/metrics.
        metrics_value (`Any`):
            The value from the metric. Example: 20.0 or "20.0 ± 1.2".
        dataset_pretty_name (`str`):
            The name of the dataset in natural language.
        dataset_id (`str`):
            Example: common_voice. A dataset id from https://hf.co/datasets.
        metrics_config (`str`, *optional*):
            The name of the metric configuration used in `load_metric()`.
            Example: bleurt-large-512 in `load_metric("bleurt", "bleurt-large-512")`.
        metrics_verified (`bool`, *optional*, defaults to `False`):
            Indicates whether the metrics originate from Hugging Face's [evaluation service](https://huggingface.co/spaces/autoevaluate/model-evaluator) or not. Automatically computed by Hugging Face, do not set.
        dataset_config (`str`, *optional*):
            Example: fr. The name of the dataset configuration used in `load_dataset()`.
        dataset_split (`str`, *optional*):
            Example: test. The name of the dataset split used in `load_dataset()`.
        dataset_revision (`str`, *optional*):
            Example: 5503434ddd753f426f4b38109466949a1217c2bb. The name of the dataset dataset revision
            used in `load_dataset()`.
        metrics_verification_token (`bool`, *optional*):
            A JSON Web Token that is used to verify whether the metrics originate from Hugging Face's [evaluation service](https://huggingface.co/spaces/autoevaluate/model-evaluator) or not.

    Returns:
        `dict`: a metadata dict with the result from a model evaluated on a dataset.

    Example:
        ```python
        >>> from huggingface_hub import metadata_eval_result
        >>> results = metadata_eval_result(
        ...         model_pretty_name="RoBERTa fine-tuned on ReactionGIF",
        ...         task_pretty_name="Text Classification",
        ...         task_id="text-classification",
        ...         metrics_pretty_name="Accuracy",
        ...         metrics_id="accuracy",
        ...         metrics_value=0.2662102282047272,
        ...         dataset_pretty_name="ReactionJPEG",
        ...         dataset_id="julien-c/reactionjpeg",
        ...         dataset_config="default",
        ...         dataset_split="test",
        ... )
        >>> results == {
        ...     'model-index': [
        ...         {
        ...             'name': 'RoBERTa fine-tuned on ReactionGIF',
        ...             'results': [
        ...                 {
        ...                     'task': {
        ...                         'type': 'text-classification',
        ...                         'name': 'Text Classification'
        ...                     },
        ...                     'dataset': {
        ...                         'name': 'ReactionJPEG',
        ...                         'type': 'julien-c/reactionjpeg',
        ...                         'config': 'default',
        ...                         'split': 'test'
        ...                     },
        ...                     'metrics': [
        ...                         {
        ...                             'type': 'accuracy',
        ...                             'value': 0.2662102282047272,
        ...                             'name': 'Accuracy',
        ...                             'verified': False
        ...                         }
        ...                     ]
        ...                 }
        ...             ]
        ...         }
        ...     ]
        ... }
        True

        ```
    """

    return {
        "model-index": eval_results_to_model_index(
            model_name=model_pretty_name,
            eval_results=[
                EvalResult(
                    task_name=task_pretty_name,
                    task_type=task_id,
                    metric_name=metrics_pretty_name,
                    metric_type=metrics_id,
                    metric_value=metrics_value,
                    dataset_name=dataset_pretty_name,
                    dataset_type=dataset_id,
                    metric_config=metrics_config,
                    verified=metrics_verified,
                    verify_token=metrics_verification_token,
                    dataset_config=dataset_config,
                    dataset_split=dataset_split,
                    dataset_revision=dataset_revision,
                )
            ],
        )
    }


@validate_hf_hub_args
def metadata_update(
    repo_id: str,
    metadata: Dict,
    *,
    repo_type: Optional[str] = None,
    overwrite: bool = False,
    token: Optional[str] = None,
    commit_message: Optional[str] = None,
    commit_description: Optional[str] = None,
    revision: Optional[str] = None,
    create_pr: bool = False,
    parent_commit: Optional[str] = None,
) -> str:
    """
    Updates the metadata in the README.md of a repository on the Hugging Face Hub.
    If the README.md file doesn't exist yet, a new one is created with metadata and an
    the default ModelCard or DatasetCard template. For `space` repo, an error is thrown
    as a Space cannot exist without a `README.md` file.

    Args:
        repo_id (`str`):
            The name of the repository.
        metadata (`dict`):
            A dictionary containing the metadata to be updated.
        repo_type (`str`, *optional*):
            Set to `"dataset"` or `"space"` if updating to a dataset or space,
            `None` or `"model"` if updating to a model. Default is `None`.
        overwrite (`bool`, *optional*, defaults to `False`):
            If set to `True` an existing field can be overwritten, otherwise
            attempting to overwrite an existing field will cause an error.
        token (`str`, *optional*):
            The Hugging Face authentication token.
        commit_message (`str`, *optional*):
            The summary / title / first line of the generated commit. Defaults to
            `f"Update metadata with huggingface_hub"`
        commit_description (`str` *optional*)
            The description of the generated commit
        revision (`str`, *optional*):
            The git revision to commit from. Defaults to the head of the
            `"main"` branch.
        create_pr (`boolean`, *optional*):
            Whether or not to create a Pull Request from `revision` with that commit.
            Defaults to `False`.
        parent_commit (`str`, *optional*):
            The OID / SHA of the parent commit, as a hexadecimal string. Shorthands (7 first characters) are also supported.
            If specified and `create_pr` is `False`, the commit will fail if `revision` does not point to `parent_commit`.
            If specified and `create_pr` is `True`, the pull request will be created from `parent_commit`.
            Specifying `parent_commit` ensures the repo has not changed before committing the changes, and can be
            especially useful if the repo is updated / committed to concurrently.
    Returns:
        `str`: URL of the commit which updated the card metadata.

    Example:
        ```python
        >>> from huggingface_hub import metadata_update
        >>> metadata = {'model-index': [{'name': 'RoBERTa fine-tuned on ReactionGIF',
        ...             'results': [{'dataset': {'name': 'ReactionGIF',
        ...                                      'type': 'julien-c/reactiongif'},
        ...                           'metrics': [{'name': 'Recall',
        ...                                        'type': 'recall',
        ...                                        'value': 0.7762102282047272}],
        ...                          'task': {'name': 'Text Classification',
        ...                                   'type': 'text-classification'}}]}]}
        >>> url = metadata_update("hf-internal-testing/reactiongif-roberta-card", metadata)

        ```
    """
    commit_message = commit_message if commit_message is not None else "Update metadata with huggingface_hub"

    # Card class given repo_type
    card_class: Type[RepoCard]
    if repo_type is None or repo_type == "model":
        card_class = ModelCard
    elif repo_type == "dataset":
        card_class = DatasetCard
    elif repo_type == "space":
        card_class = RepoCard
    else:
        raise ValueError(f"Unknown repo_type: {repo_type}")

    # Either load repo_card from the Hub or create an empty one.
    # NOTE: Will not create the repo if it doesn't exist.
    try:
        card = card_class.load(repo_id, token=token, repo_type=repo_type)
    except EntryNotFoundError:
        if repo_type == "space":
            raise ValueError("Cannot update metadata on a Space that doesn't contain a `README.md` file.")

        # Initialize a ModelCard or DatasetCard from default template and no data.
        card = card_class.from_template(CardData())

    for key, value in metadata.items():
        if key == "model-index":
            # if the new metadata doesn't include a name, either use existing one or repo name
            if "name" not in value[0]:
                value[0]["name"] = getattr(card, "model_name", repo_id)
            model_name, new_results = model_index_to_eval_results(value)
            if card.data.eval_results is None:
                card.data.eval_results = new_results
                card.data.model_name = model_name
            else:
                existing_results = card.data.eval_results

                # Iterate over new results
                #   Iterate over existing results
                #       If both results describe the same metric but value is different:
                #           If overwrite=True: overwrite the metric value
                #           Else: raise ValueError
                #       Else: append new result to existing ones.
                for new_result in new_results:
                    result_found = False
                    for existing_result in existing_results:
                        if new_result.is_equal_except_value(existing_result):
                            if new_result != existing_result and not overwrite:
                                raise ValueError(
                                    "You passed a new value for the existing metric"
                                    f" 'name: {new_result.metric_name}, type: "
                                    f"{new_result.metric_type}'. Set `overwrite=True`"
                                    " to overwrite existing metrics."
                                )
                            result_found = True
                            existing_result.metric_value = new_result.metric_value
                            if existing_result.verified is True:
                                existing_result.verify_token = new_result.verify_token
                    if not result_found:
                        card.data.eval_results.append(new_result)
        else:
            # Any metadata that is not a result metric
            if card.data.get(key) is not None and not overwrite and card.data.get(key) != value:
                raise ValueError(
                    f"You passed a new value for the existing meta data field '{key}'."
                    " Set `overwrite=True` to overwrite existing metadata."
                )
            else:
                card.data[key] = value

    return card.push_to_hub(
        repo_id,
        token=token,
        repo_type=repo_type,
        commit_message=commit_message,
        commit_description=commit_description,
        create_pr=create_pr,
        revision=revision,
        parent_commit=parent_commit,
    )
