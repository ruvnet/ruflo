# File generated from our OpenAPI spec by Stainless.

from typing_extensions import override

from . import resources, _load_client
from ._utils import LazyProxy


class ChatProxy(LazyProxy[resources.Chat]):
    @override
    def __load__(self) -> resources.Chat:
        return _load_client().chat


class BetaProxy(LazyProxy[resources.Beta]):
    @override
    def __load__(self) -> resources.Beta:
        return _load_client().beta


class FilesProxy(LazyProxy[resources.Files]):
    @override
    def __load__(self) -> resources.Files:
        return _load_client().files


class AudioProxy(LazyProxy[resources.Audio]):
    @override
    def __load__(self) -> resources.Audio:
        return _load_client().audio


class ImagesProxy(LazyProxy[resources.Images]):
    @override
    def __load__(self) -> resources.Images:
        return _load_client().images


class ModelsProxy(LazyProxy[resources.Models]):
    @override
    def __load__(self) -> resources.Models:
        return _load_client().models


class EmbeddingsProxy(LazyProxy[resources.Embeddings]):
    @override
    def __load__(self) -> resources.Embeddings:
        return _load_client().embeddings


class CompletionsProxy(LazyProxy[resources.Completions]):
    @override
    def __load__(self) -> resources.Completions:
        return _load_client().completions


class ModerationsProxy(LazyProxy[resources.Moderations]):
    @override
    def __load__(self) -> resources.Moderations:
        return _load_client().moderations


class FineTuningProxy(LazyProxy[resources.FineTuning]):
    @override
    def __load__(self) -> resources.FineTuning:
        return _load_client().fine_tuning


chat: resources.Chat = ChatProxy().__as_proxied__()
beta: resources.Beta = BetaProxy().__as_proxied__()
files: resources.Files = FilesProxy().__as_proxied__()
audio: resources.Audio = AudioProxy().__as_proxied__()
images: resources.Images = ImagesProxy().__as_proxied__()
models: resources.Models = ModelsProxy().__as_proxied__()
embeddings: resources.Embeddings = EmbeddingsProxy().__as_proxied__()
completions: resources.Completions = CompletionsProxy().__as_proxied__()
moderations: resources.Moderations = ModerationsProxy().__as_proxied__()
fine_tuning: resources.FineTuning = FineTuningProxy().__as_proxied__()
