# File generated from our OpenAPI spec by Stainless.

from pydantic import Field as FieldInfo

from .._models import BaseModel

__all__ = ["Moderation", "Categories", "CategoryScores"]


class Categories(BaseModel):
    harassment: bool
    """
    Content that expresses, incites, or promotes harassing language towards any
    target.
    """

    harassment_threatening: bool = FieldInfo(alias="harassment/threatening")
    """
    Harassment content that also includes violence or serious harm towards any
    target.
    """

    hate: bool
    """
    Content that expresses, incites, or promotes hate based on race, gender,
    ethnicity, religion, nationality, sexual orientation, disability status, or
    caste. Hateful content aimed at non-protected groups (e.g., chess players) is
    harassment.
    """

    hate_threatening: bool = FieldInfo(alias="hate/threatening")
    """
    Hateful content that also includes violence or serious harm towards the targeted
    group based on race, gender, ethnicity, religion, nationality, sexual
    orientation, disability status, or caste.
    """

    self_harm: bool = FieldInfo(alias="self-harm")
    """
    Content that promotes, encourages, or depicts acts of self-harm, such as
    suicide, cutting, and eating disorders.
    """

    self_harm_instructions: bool = FieldInfo(alias="self-harm/instructions")
    """
    Content that encourages performing acts of self-harm, such as suicide, cutting,
    and eating disorders, or that gives instructions or advice on how to commit such
    acts.
    """

    self_harm_intent: bool = FieldInfo(alias="self-harm/intent")
    """
    Content where the speaker expresses that they are engaging or intend to engage
    in acts of self-harm, such as suicide, cutting, and eating disorders.
    """

    sexual: bool
    """
    Content meant to arouse sexual excitement, such as the description of sexual
    activity, or that promotes sexual services (excluding sex education and
    wellness).
    """

    sexual_minors: bool = FieldInfo(alias="sexual/minors")
    """Sexual content that includes an individual who is under 18 years old."""

    violence: bool
    """Content that depicts death, violence, or physical injury."""

    violence_graphic: bool = FieldInfo(alias="violence/graphic")
    """Content that depicts death, violence, or physical injury in graphic detail."""


class CategoryScores(BaseModel):
    harassment: float
    """The score for the category 'harassment'."""

    harassment_threatening: float = FieldInfo(alias="harassment/threatening")
    """The score for the category 'harassment/threatening'."""

    hate: float
    """The score for the category 'hate'."""

    hate_threatening: float = FieldInfo(alias="hate/threatening")
    """The score for the category 'hate/threatening'."""

    self_harm: float = FieldInfo(alias="self-harm")
    """The score for the category 'self-harm'."""

    self_harm_instructions: float = FieldInfo(alias="self-harm/instructions")
    """The score for the category 'self-harm/instructions'."""

    self_harm_intent: float = FieldInfo(alias="self-harm/intent")
    """The score for the category 'self-harm/intent'."""

    sexual: float
    """The score for the category 'sexual'."""

    sexual_minors: float = FieldInfo(alias="sexual/minors")
    """The score for the category 'sexual/minors'."""

    violence: float
    """The score for the category 'violence'."""

    violence_graphic: float = FieldInfo(alias="violence/graphic")
    """The score for the category 'violence/graphic'."""


class Moderation(BaseModel):
    categories: Categories
    """A list of the categories, and whether they are flagged or not."""

    category_scores: CategoryScores
    """A list of the categories along with their scores as predicted by model."""

    flagged: bool
    """
    Whether the content violates
    [OpenAI's usage policies](/policies/usage-policies).
    """
