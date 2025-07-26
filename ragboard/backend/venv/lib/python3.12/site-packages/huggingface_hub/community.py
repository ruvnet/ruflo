"""
Data structures to interact with Discussions and Pull Requests on the Hub.

See [the Discussions and Pull Requests guide](https://huggingface.co/docs/hub/repositories-pull-requests-discussions)
for more information on Pull Requests, Discussions, and the community tab.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import List, Literal, Optional, Union

from . import constants
from .utils import parse_datetime


DiscussionStatus = Literal["open", "closed", "merged", "draft"]


@dataclass
class Discussion:
    """
    A Discussion or Pull Request on the Hub.

    This dataclass is not intended to be instantiated directly.

    Attributes:
        title (`str`):
            The title of the Discussion / Pull Request
        status (`str`):
            The status of the Discussion / Pull Request.
            It must be one of:
                * `"open"`
                * `"closed"`
                * `"merged"` (only for Pull Requests )
                * `"draft"` (only for Pull Requests )
        num (`int`):
            The number of the Discussion / Pull Request.
        repo_id (`str`):
            The id (`"{namespace}/{repo_name}"`) of the repo on which
            the Discussion / Pull Request was open.
        repo_type (`str`):
            The type of the repo on which the Discussion / Pull Request was open.
            Possible values are: `"model"`, `"dataset"`, `"space"`.
        author (`str`):
            The username of the Discussion / Pull Request author.
            Can be `"deleted"` if the user has been deleted since.
        is_pull_request (`bool`):
            Whether or not this is a Pull Request.
        created_at (`datetime`):
            The `datetime` of creation of the Discussion / Pull Request.
        endpoint (`str`):
            Endpoint of the Hub. Default is https://huggingface.co.
        git_reference (`str`, *optional*):
            (property) Git reference to which changes can be pushed if this is a Pull Request, `None` otherwise.
        url (`str`):
            (property) URL of the discussion on the Hub.
    """

    title: str
    status: DiscussionStatus
    num: int
    repo_id: str
    repo_type: str
    author: str
    is_pull_request: bool
    created_at: datetime
    endpoint: str

    @property
    def git_reference(self) -> Optional[str]:
        """
        If this is a Pull Request , returns the git reference to which changes can be pushed.
        Returns `None` otherwise.
        """
        if self.is_pull_request:
            return f"refs/pr/{self.num}"
        return None

    @property
    def url(self) -> str:
        """Returns the URL of the discussion on the Hub."""
        if self.repo_type is None or self.repo_type == constants.REPO_TYPE_MODEL:
            return f"{self.endpoint}/{self.repo_id}/discussions/{self.num}"
        return f"{self.endpoint}/{self.repo_type}s/{self.repo_id}/discussions/{self.num}"


@dataclass
class DiscussionWithDetails(Discussion):
    """
    Subclass of [`Discussion`].

    Attributes:
        title (`str`):
            The title of the Discussion / Pull Request
        status (`str`):
            The status of the Discussion / Pull Request.
            It can be one of:
                * `"open"`
                * `"closed"`
                * `"merged"` (only for Pull Requests )
                * `"draft"` (only for Pull Requests )
        num (`int`):
            The number of the Discussion / Pull Request.
        repo_id (`str`):
            The id (`"{namespace}/{repo_name}"`) of the repo on which
            the Discussion / Pull Request was open.
        repo_type (`str`):
            The type of the repo on which the Discussion / Pull Request was open.
            Possible values are: `"model"`, `"dataset"`, `"space"`.
        author (`str`):
            The username of the Discussion / Pull Request author.
            Can be `"deleted"` if the user has been deleted since.
        is_pull_request (`bool`):
            Whether or not this is a Pull Request.
        created_at (`datetime`):
            The `datetime` of creation of the Discussion / Pull Request.
        events (`list` of [`DiscussionEvent`])
            The list of [`DiscussionEvents`] in this Discussion or Pull Request.
        conflicting_files (`Union[List[str], bool, None]`, *optional*):
            A list of conflicting files if this is a Pull Request.
            `None` if `self.is_pull_request` is `False`.
            `True` if there are conflicting files but the list can't be retrieved.
        target_branch (`str`, *optional*):
            The branch into which changes are to be merged if this is a
            Pull Request . `None`  if `self.is_pull_request` is `False`.
        merge_commit_oid (`str`, *optional*):
            If this is a merged Pull Request , this is set to the OID / SHA of
            the merge commit, `None` otherwise.
        diff (`str`, *optional*):
            The git diff if this is a Pull Request , `None` otherwise.
        endpoint (`str`):
            Endpoint of the Hub. Default is https://huggingface.co.
        git_reference (`str`, *optional*):
            (property) Git reference to which changes can be pushed if this is a Pull Request, `None` otherwise.
        url (`str`):
            (property) URL of the discussion on the Hub.
    """

    events: List["DiscussionEvent"]
    conflicting_files: Union[List[str], bool, None]
    target_branch: Optional[str]
    merge_commit_oid: Optional[str]
    diff: Optional[str]


@dataclass
class DiscussionEvent:
    """
    An event in a Discussion or Pull Request.

    Use concrete classes:
        * [`DiscussionComment`]
        * [`DiscussionStatusChange`]
        * [`DiscussionCommit`]
        * [`DiscussionTitleChange`]

    Attributes:
        id (`str`):
            The ID of the event. An hexadecimal string.
        type (`str`):
            The type of the event.
        created_at (`datetime`):
            A [`datetime`](https://docs.python.org/3/library/datetime.html?highlight=datetime#datetime.datetime)
            object holding the creation timestamp for the event.
        author (`str`):
            The username of the Discussion / Pull Request author.
            Can be `"deleted"` if the user has been deleted since.
    """

    id: str
    type: str
    created_at: datetime
    author: str

    _event: dict
    """Stores the original event data, in case we need to access it later."""


@dataclass
class DiscussionComment(DiscussionEvent):
    """A comment in a Discussion / Pull Request.

    Subclass of [`DiscussionEvent`].


    Attributes:
        id (`str`):
            The ID of the event. An hexadecimal string.
        type (`str`):
            The type of the event.
        created_at (`datetime`):
            A [`datetime`](https://docs.python.org/3/library/datetime.html?highlight=datetime#datetime.datetime)
            object holding the creation timestamp for the event.
        author (`str`):
            The username of the Discussion / Pull Request author.
            Can be `"deleted"` if the user has been deleted since.
        content (`str`):
            The raw markdown content of the comment. Mentions, links and images are not rendered.
        edited (`bool`):
            Whether or not this comment has been edited.
        hidden (`bool`):
            Whether or not this comment has been hidden.
    """

    content: str
    edited: bool
    hidden: bool

    @property
    def rendered(self) -> str:
        """The rendered comment, as a HTML string"""
        return self._event["data"]["latest"]["html"]

    @property
    def last_edited_at(self) -> datetime:
        """The last edit time, as a `datetime` object."""
        return parse_datetime(self._event["data"]["latest"]["updatedAt"])

    @property
    def last_edited_by(self) -> str:
        """The last edit time, as a `datetime` object."""
        return self._event["data"]["latest"].get("author", {}).get("name", "deleted")

    @property
    def edit_history(self) -> List[dict]:
        """The edit history of the comment"""
        return self._event["data"]["history"]

    @property
    def number_of_edits(self) -> int:
        return len(self.edit_history)


@dataclass
class DiscussionStatusChange(DiscussionEvent):
    """A change of status in a Discussion / Pull Request.

    Subclass of [`DiscussionEvent`].

    Attributes:
        id (`str`):
            The ID of the event. An hexadecimal string.
        type (`str`):
            The type of the event.
        created_at (`datetime`):
            A [`datetime`](https://docs.python.org/3/library/datetime.html?highlight=datetime#datetime.datetime)
            object holding the creation timestamp for the event.
        author (`str`):
            The username of the Discussion / Pull Request author.
            Can be `"deleted"` if the user has been deleted since.
        new_status (`str`):
            The status of the Discussion / Pull Request after the change.
            It can be one of:
                * `"open"`
                * `"closed"`
                * `"merged"` (only for Pull Requests )
    """

    new_status: str


@dataclass
class DiscussionCommit(DiscussionEvent):
    """A commit in a Pull Request.

    Subclass of [`DiscussionEvent`].

    Attributes:
        id (`str`):
            The ID of the event. An hexadecimal string.
        type (`str`):
            The type of the event.
        created_at (`datetime`):
            A [`datetime`](https://docs.python.org/3/library/datetime.html?highlight=datetime#datetime.datetime)
            object holding the creation timestamp for the event.
        author (`str`):
            The username of the Discussion / Pull Request author.
            Can be `"deleted"` if the user has been deleted since.
        summary (`str`):
            The summary of the commit.
        oid (`str`):
            The OID / SHA of the commit, as a hexadecimal string.
    """

    summary: str
    oid: str


@dataclass
class DiscussionTitleChange(DiscussionEvent):
    """A rename event in a Discussion / Pull Request.

    Subclass of [`DiscussionEvent`].

    Attributes:
        id (`str`):
            The ID of the event. An hexadecimal string.
        type (`str`):
            The type of the event.
        created_at (`datetime`):
            A [`datetime`](https://docs.python.org/3/library/datetime.html?highlight=datetime#datetime.datetime)
            object holding the creation timestamp for the event.
        author (`str`):
            The username of the Discussion / Pull Request author.
            Can be `"deleted"` if the user has been deleted since.
        old_title (`str`):
            The previous title for the Discussion / Pull Request.
        new_title (`str`):
            The new title.
    """

    old_title: str
    new_title: str


def deserialize_event(event: dict) -> DiscussionEvent:
    """Instantiates a [`DiscussionEvent`] from a dict"""
    event_id: str = event["id"]
    event_type: str = event["type"]
    created_at = parse_datetime(event["createdAt"])

    common_args = dict(
        id=event_id,
        type=event_type,
        created_at=created_at,
        author=event.get("author", {}).get("name", "deleted"),
        _event=event,
    )

    if event_type == "comment":
        return DiscussionComment(
            **common_args,
            edited=event["data"]["edited"],
            hidden=event["data"]["hidden"],
            content=event["data"]["latest"]["raw"],
        )
    if event_type == "status-change":
        return DiscussionStatusChange(
            **common_args,
            new_status=event["data"]["status"],
        )
    if event_type == "commit":
        return DiscussionCommit(
            **common_args,
            summary=event["data"]["subject"],
            oid=event["data"]["oid"],
        )
    if event_type == "title-change":
        return DiscussionTitleChange(
            **common_args,
            old_title=event["data"]["from"],
            new_title=event["data"]["to"],
        )

    return DiscussionEvent(**common_args)
