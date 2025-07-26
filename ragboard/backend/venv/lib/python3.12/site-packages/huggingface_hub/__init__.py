# Copyright 2020 The HuggingFace Team. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# ***********
# `huggingface_hub` init has 2 modes:
# - Normal usage:
#       If imported to use it, all modules and functions are lazy-loaded. This means
#       they exist at top level in module but are imported only the first time they are
#       used. This way, `from huggingface_hub import something` will import `something`
#       quickly without the hassle of importing all the features from `huggingface_hub`.
# - Static check:
#       If statically analyzed, all modules and functions are loaded normally. This way
#       static typing check works properly as well as autocomplete in text editors and
#       IDEs.
#
# The static model imports are done inside the `if TYPE_CHECKING:` statement at
# the bottom of this file. Since module/functions imports are duplicated, it is
# mandatory to make sure to add them twice when adding one. This is checked in the
# `make quality` command.
#
# To update the static imports, please run the following command and commit the changes.
# ```
# # Use script
# python utils/check_static_imports.py --update-file
#
# # Or run style on codebase
# make style
# ```
#
# ***********
# Lazy loader vendored from https://github.com/scientific-python/lazy_loader
import importlib
import os
import sys
from typing import TYPE_CHECKING

__version__ = "0.33.5"

# Alphabetical order of definitions is ensured in tests
# WARNING: any comment added in this dictionary definition will be lost when
# re-generating the file !
_SUBMOD_ATTRS = {
    "_commit_scheduler": [
        "CommitScheduler",
    ],
    "_inference_endpoints": [
        "InferenceEndpoint",
        "InferenceEndpointError",
        "InferenceEndpointStatus",
        "InferenceEndpointTimeoutError",
        "InferenceEndpointType",
    ],
    "_login": [
        "auth_list",
        "auth_switch",
        "interpreter_login",
        "login",
        "logout",
        "notebook_login",
    ],
    "_oauth": [
        "OAuthInfo",
        "OAuthOrgInfo",
        "OAuthUserInfo",
        "attach_huggingface_oauth",
        "parse_huggingface_oauth",
    ],
    "_snapshot_download": [
        "snapshot_download",
    ],
    "_space_api": [
        "SpaceHardware",
        "SpaceRuntime",
        "SpaceStage",
        "SpaceStorage",
        "SpaceVariable",
    ],
    "_tensorboard_logger": [
        "HFSummaryWriter",
    ],
    "_webhooks_payload": [
        "WebhookPayload",
        "WebhookPayloadComment",
        "WebhookPayloadDiscussion",
        "WebhookPayloadDiscussionChanges",
        "WebhookPayloadEvent",
        "WebhookPayloadMovedTo",
        "WebhookPayloadRepo",
        "WebhookPayloadUrl",
        "WebhookPayloadWebhook",
    ],
    "_webhooks_server": [
        "WebhooksServer",
        "webhook_endpoint",
    ],
    "community": [
        "Discussion",
        "DiscussionComment",
        "DiscussionCommit",
        "DiscussionEvent",
        "DiscussionStatusChange",
        "DiscussionTitleChange",
        "DiscussionWithDetails",
    ],
    "constants": [
        "CONFIG_NAME",
        "FLAX_WEIGHTS_NAME",
        "HUGGINGFACE_CO_URL_HOME",
        "HUGGINGFACE_CO_URL_TEMPLATE",
        "PYTORCH_WEIGHTS_NAME",
        "REPO_TYPE_DATASET",
        "REPO_TYPE_MODEL",
        "REPO_TYPE_SPACE",
        "TF2_WEIGHTS_NAME",
        "TF_WEIGHTS_NAME",
    ],
    "fastai_utils": [
        "_save_pretrained_fastai",
        "from_pretrained_fastai",
        "push_to_hub_fastai",
    ],
    "file_download": [
        "HfFileMetadata",
        "_CACHED_NO_EXIST",
        "get_hf_file_metadata",
        "hf_hub_download",
        "hf_hub_url",
        "try_to_load_from_cache",
    ],
    "hf_api": [
        "Collection",
        "CollectionItem",
        "CommitInfo",
        "CommitOperation",
        "CommitOperationAdd",
        "CommitOperationCopy",
        "CommitOperationDelete",
        "DatasetInfo",
        "GitCommitInfo",
        "GitRefInfo",
        "GitRefs",
        "HfApi",
        "ModelInfo",
        "RepoUrl",
        "SpaceInfo",
        "User",
        "UserLikes",
        "WebhookInfo",
        "WebhookWatchedItem",
        "accept_access_request",
        "add_collection_item",
        "add_space_secret",
        "add_space_variable",
        "auth_check",
        "cancel_access_request",
        "change_discussion_status",
        "comment_discussion",
        "create_branch",
        "create_collection",
        "create_commit",
        "create_discussion",
        "create_inference_endpoint",
        "create_inference_endpoint_from_catalog",
        "create_pull_request",
        "create_repo",
        "create_tag",
        "create_webhook",
        "dataset_info",
        "delete_branch",
        "delete_collection",
        "delete_collection_item",
        "delete_file",
        "delete_folder",
        "delete_inference_endpoint",
        "delete_repo",
        "delete_space_secret",
        "delete_space_storage",
        "delete_space_variable",
        "delete_tag",
        "delete_webhook",
        "disable_webhook",
        "duplicate_space",
        "edit_discussion_comment",
        "enable_webhook",
        "file_exists",
        "get_collection",
        "get_dataset_tags",
        "get_discussion_details",
        "get_full_repo_name",
        "get_inference_endpoint",
        "get_model_tags",
        "get_paths_info",
        "get_repo_discussions",
        "get_safetensors_metadata",
        "get_space_runtime",
        "get_space_variables",
        "get_token_permission",
        "get_user_overview",
        "get_webhook",
        "grant_access",
        "list_accepted_access_requests",
        "list_collections",
        "list_datasets",
        "list_inference_catalog",
        "list_inference_endpoints",
        "list_lfs_files",
        "list_liked_repos",
        "list_models",
        "list_organization_members",
        "list_papers",
        "list_pending_access_requests",
        "list_rejected_access_requests",
        "list_repo_commits",
        "list_repo_files",
        "list_repo_likers",
        "list_repo_refs",
        "list_repo_tree",
        "list_spaces",
        "list_user_followers",
        "list_user_following",
        "list_webhooks",
        "merge_pull_request",
        "model_info",
        "move_repo",
        "paper_info",
        "parse_safetensors_file_metadata",
        "pause_inference_endpoint",
        "pause_space",
        "permanently_delete_lfs_files",
        "preupload_lfs_files",
        "reject_access_request",
        "rename_discussion",
        "repo_exists",
        "repo_info",
        "repo_type_and_id_from_hf_id",
        "request_space_hardware",
        "request_space_storage",
        "restart_space",
        "resume_inference_endpoint",
        "revision_exists",
        "run_as_future",
        "scale_to_zero_inference_endpoint",
        "set_space_sleep_time",
        "space_info",
        "super_squash_history",
        "unlike",
        "update_collection_item",
        "update_collection_metadata",
        "update_inference_endpoint",
        "update_repo_settings",
        "update_repo_visibility",
        "update_webhook",
        "upload_file",
        "upload_folder",
        "upload_large_folder",
        "whoami",
    ],
    "hf_file_system": [
        "HfFileSystem",
        "HfFileSystemFile",
        "HfFileSystemResolvedPath",
        "HfFileSystemStreamFile",
    ],
    "hub_mixin": [
        "ModelHubMixin",
        "PyTorchModelHubMixin",
    ],
    "inference._client": [
        "InferenceClient",
        "InferenceTimeoutError",
    ],
    "inference._generated._async_client": [
        "AsyncInferenceClient",
    ],
    "inference._generated.types": [
        "AudioClassificationInput",
        "AudioClassificationOutputElement",
        "AudioClassificationOutputTransform",
        "AudioClassificationParameters",
        "AudioToAudioInput",
        "AudioToAudioOutputElement",
        "AutomaticSpeechRecognitionEarlyStoppingEnum",
        "AutomaticSpeechRecognitionGenerationParameters",
        "AutomaticSpeechRecognitionInput",
        "AutomaticSpeechRecognitionOutput",
        "AutomaticSpeechRecognitionOutputChunk",
        "AutomaticSpeechRecognitionParameters",
        "ChatCompletionInput",
        "ChatCompletionInputFunctionDefinition",
        "ChatCompletionInputFunctionName",
        "ChatCompletionInputGrammarType",
        "ChatCompletionInputJSONSchema",
        "ChatCompletionInputMessage",
        "ChatCompletionInputMessageChunk",
        "ChatCompletionInputMessageChunkType",
        "ChatCompletionInputResponseFormatJSONObject",
        "ChatCompletionInputResponseFormatJSONSchema",
        "ChatCompletionInputResponseFormatText",
        "ChatCompletionInputStreamOptions",
        "ChatCompletionInputTool",
        "ChatCompletionInputToolCall",
        "ChatCompletionInputToolChoiceClass",
        "ChatCompletionInputToolChoiceEnum",
        "ChatCompletionInputURL",
        "ChatCompletionOutput",
        "ChatCompletionOutputComplete",
        "ChatCompletionOutputFunctionDefinition",
        "ChatCompletionOutputLogprob",
        "ChatCompletionOutputLogprobs",
        "ChatCompletionOutputMessage",
        "ChatCompletionOutputToolCall",
        "ChatCompletionOutputTopLogprob",
        "ChatCompletionOutputUsage",
        "ChatCompletionStreamOutput",
        "ChatCompletionStreamOutputChoice",
        "ChatCompletionStreamOutputDelta",
        "ChatCompletionStreamOutputDeltaToolCall",
        "ChatCompletionStreamOutputFunction",
        "ChatCompletionStreamOutputLogprob",
        "ChatCompletionStreamOutputLogprobs",
        "ChatCompletionStreamOutputTopLogprob",
        "ChatCompletionStreamOutputUsage",
        "DepthEstimationInput",
        "DepthEstimationOutput",
        "DocumentQuestionAnsweringInput",
        "DocumentQuestionAnsweringInputData",
        "DocumentQuestionAnsweringOutputElement",
        "DocumentQuestionAnsweringParameters",
        "FeatureExtractionInput",
        "FeatureExtractionInputTruncationDirection",
        "FillMaskInput",
        "FillMaskOutputElement",
        "FillMaskParameters",
        "ImageClassificationInput",
        "ImageClassificationOutputElement",
        "ImageClassificationOutputTransform",
        "ImageClassificationParameters",
        "ImageSegmentationInput",
        "ImageSegmentationOutputElement",
        "ImageSegmentationParameters",
        "ImageSegmentationSubtask",
        "ImageToImageInput",
        "ImageToImageOutput",
        "ImageToImageParameters",
        "ImageToImageTargetSize",
        "ImageToTextEarlyStoppingEnum",
        "ImageToTextGenerationParameters",
        "ImageToTextInput",
        "ImageToTextOutput",
        "ImageToTextParameters",
        "ObjectDetectionBoundingBox",
        "ObjectDetectionInput",
        "ObjectDetectionOutputElement",
        "ObjectDetectionParameters",
        "Padding",
        "QuestionAnsweringInput",
        "QuestionAnsweringInputData",
        "QuestionAnsweringOutputElement",
        "QuestionAnsweringParameters",
        "SentenceSimilarityInput",
        "SentenceSimilarityInputData",
        "SummarizationInput",
        "SummarizationOutput",
        "SummarizationParameters",
        "SummarizationTruncationStrategy",
        "TableQuestionAnsweringInput",
        "TableQuestionAnsweringInputData",
        "TableQuestionAnsweringOutputElement",
        "TableQuestionAnsweringParameters",
        "Text2TextGenerationInput",
        "Text2TextGenerationOutput",
        "Text2TextGenerationParameters",
        "Text2TextGenerationTruncationStrategy",
        "TextClassificationInput",
        "TextClassificationOutputElement",
        "TextClassificationOutputTransform",
        "TextClassificationParameters",
        "TextGenerationInput",
        "TextGenerationInputGenerateParameters",
        "TextGenerationInputGrammarType",
        "TextGenerationOutput",
        "TextGenerationOutputBestOfSequence",
        "TextGenerationOutputDetails",
        "TextGenerationOutputFinishReason",
        "TextGenerationOutputPrefillToken",
        "TextGenerationOutputToken",
        "TextGenerationStreamOutput",
        "TextGenerationStreamOutputStreamDetails",
        "TextGenerationStreamOutputToken",
        "TextToAudioEarlyStoppingEnum",
        "TextToAudioGenerationParameters",
        "TextToAudioInput",
        "TextToAudioOutput",
        "TextToAudioParameters",
        "TextToImageInput",
        "TextToImageOutput",
        "TextToImageParameters",
        "TextToSpeechEarlyStoppingEnum",
        "TextToSpeechGenerationParameters",
        "TextToSpeechInput",
        "TextToSpeechOutput",
        "TextToSpeechParameters",
        "TextToVideoInput",
        "TextToVideoOutput",
        "TextToVideoParameters",
        "TokenClassificationAggregationStrategy",
        "TokenClassificationInput",
        "TokenClassificationOutputElement",
        "TokenClassificationParameters",
        "TranslationInput",
        "TranslationOutput",
        "TranslationParameters",
        "TranslationTruncationStrategy",
        "TypeEnum",
        "VideoClassificationInput",
        "VideoClassificationOutputElement",
        "VideoClassificationOutputTransform",
        "VideoClassificationParameters",
        "VisualQuestionAnsweringInput",
        "VisualQuestionAnsweringInputData",
        "VisualQuestionAnsweringOutputElement",
        "VisualQuestionAnsweringParameters",
        "ZeroShotClassificationInput",
        "ZeroShotClassificationOutputElement",
        "ZeroShotClassificationParameters",
        "ZeroShotImageClassificationInput",
        "ZeroShotImageClassificationOutputElement",
        "ZeroShotImageClassificationParameters",
        "ZeroShotObjectDetectionBoundingBox",
        "ZeroShotObjectDetectionInput",
        "ZeroShotObjectDetectionOutputElement",
        "ZeroShotObjectDetectionParameters",
    ],
    "inference._mcp.agent": [
        "Agent",
    ],
    "inference._mcp.mcp_client": [
        "MCPClient",
    ],
    "inference_api": [
        "InferenceApi",
    ],
    "keras_mixin": [
        "KerasModelHubMixin",
        "from_pretrained_keras",
        "push_to_hub_keras",
        "save_pretrained_keras",
    ],
    "repocard": [
        "DatasetCard",
        "ModelCard",
        "RepoCard",
        "SpaceCard",
        "metadata_eval_result",
        "metadata_load",
        "metadata_save",
        "metadata_update",
    ],
    "repocard_data": [
        "CardData",
        "DatasetCardData",
        "EvalResult",
        "ModelCardData",
        "SpaceCardData",
    ],
    "repository": [
        "Repository",
    ],
    "serialization": [
        "StateDictSplit",
        "get_tf_storage_size",
        "get_torch_storage_id",
        "get_torch_storage_size",
        "load_state_dict_from_file",
        "load_torch_model",
        "save_torch_model",
        "save_torch_state_dict",
        "split_state_dict_into_shards_factory",
        "split_tf_state_dict_into_shards",
        "split_torch_state_dict_into_shards",
    ],
    "serialization._dduf": [
        "DDUFEntry",
        "export_entries_as_dduf",
        "export_folder_as_dduf",
        "read_dduf_file",
    ],
    "utils": [
        "CacheNotFound",
        "CachedFileInfo",
        "CachedRepoInfo",
        "CachedRevisionInfo",
        "CorruptedCacheException",
        "DeleteCacheStrategy",
        "HFCacheInfo",
        "HfFolder",
        "cached_assets_path",
        "configure_http_backend",
        "dump_environment_info",
        "get_session",
        "get_token",
        "logging",
        "scan_cache_dir",
    ],
}

# WARNING: __all__ is generated automatically, Any manual edit will be lost when re-generating this file !
#
# To update the static imports, please run the following command and commit the changes.
# ```
# # Use script
# python utils/check_all_variable.py --update
#
# # Or run style on codebase
# make style
# ```

__all__ = [
    "Agent",
    "AsyncInferenceClient",
    "AudioClassificationInput",
    "AudioClassificationOutputElement",
    "AudioClassificationOutputTransform",
    "AudioClassificationParameters",
    "AudioToAudioInput",
    "AudioToAudioOutputElement",
    "AutomaticSpeechRecognitionEarlyStoppingEnum",
    "AutomaticSpeechRecognitionGenerationParameters",
    "AutomaticSpeechRecognitionInput",
    "AutomaticSpeechRecognitionOutput",
    "AutomaticSpeechRecognitionOutputChunk",
    "AutomaticSpeechRecognitionParameters",
    "CONFIG_NAME",
    "CacheNotFound",
    "CachedFileInfo",
    "CachedRepoInfo",
    "CachedRevisionInfo",
    "CardData",
    "ChatCompletionInput",
    "ChatCompletionInputFunctionDefinition",
    "ChatCompletionInputFunctionName",
    "ChatCompletionInputGrammarType",
    "ChatCompletionInputJSONSchema",
    "ChatCompletionInputMessage",
    "ChatCompletionInputMessageChunk",
    "ChatCompletionInputMessageChunkType",
    "ChatCompletionInputResponseFormatJSONObject",
    "ChatCompletionInputResponseFormatJSONSchema",
    "ChatCompletionInputResponseFormatText",
    "ChatCompletionInputStreamOptions",
    "ChatCompletionInputTool",
    "ChatCompletionInputToolCall",
    "ChatCompletionInputToolChoiceClass",
    "ChatCompletionInputToolChoiceEnum",
    "ChatCompletionInputURL",
    "ChatCompletionOutput",
    "ChatCompletionOutputComplete",
    "ChatCompletionOutputFunctionDefinition",
    "ChatCompletionOutputLogprob",
    "ChatCompletionOutputLogprobs",
    "ChatCompletionOutputMessage",
    "ChatCompletionOutputToolCall",
    "ChatCompletionOutputTopLogprob",
    "ChatCompletionOutputUsage",
    "ChatCompletionStreamOutput",
    "ChatCompletionStreamOutputChoice",
    "ChatCompletionStreamOutputDelta",
    "ChatCompletionStreamOutputDeltaToolCall",
    "ChatCompletionStreamOutputFunction",
    "ChatCompletionStreamOutputLogprob",
    "ChatCompletionStreamOutputLogprobs",
    "ChatCompletionStreamOutputTopLogprob",
    "ChatCompletionStreamOutputUsage",
    "Collection",
    "CollectionItem",
    "CommitInfo",
    "CommitOperation",
    "CommitOperationAdd",
    "CommitOperationCopy",
    "CommitOperationDelete",
    "CommitScheduler",
    "CorruptedCacheException",
    "DDUFEntry",
    "DatasetCard",
    "DatasetCardData",
    "DatasetInfo",
    "DeleteCacheStrategy",
    "DepthEstimationInput",
    "DepthEstimationOutput",
    "Discussion",
    "DiscussionComment",
    "DiscussionCommit",
    "DiscussionEvent",
    "DiscussionStatusChange",
    "DiscussionTitleChange",
    "DiscussionWithDetails",
    "DocumentQuestionAnsweringInput",
    "DocumentQuestionAnsweringInputData",
    "DocumentQuestionAnsweringOutputElement",
    "DocumentQuestionAnsweringParameters",
    "EvalResult",
    "FLAX_WEIGHTS_NAME",
    "FeatureExtractionInput",
    "FeatureExtractionInputTruncationDirection",
    "FillMaskInput",
    "FillMaskOutputElement",
    "FillMaskParameters",
    "GitCommitInfo",
    "GitRefInfo",
    "GitRefs",
    "HFCacheInfo",
    "HFSummaryWriter",
    "HUGGINGFACE_CO_URL_HOME",
    "HUGGINGFACE_CO_URL_TEMPLATE",
    "HfApi",
    "HfFileMetadata",
    "HfFileSystem",
    "HfFileSystemFile",
    "HfFileSystemResolvedPath",
    "HfFileSystemStreamFile",
    "HfFolder",
    "ImageClassificationInput",
    "ImageClassificationOutputElement",
    "ImageClassificationOutputTransform",
    "ImageClassificationParameters",
    "ImageSegmentationInput",
    "ImageSegmentationOutputElement",
    "ImageSegmentationParameters",
    "ImageSegmentationSubtask",
    "ImageToImageInput",
    "ImageToImageOutput",
    "ImageToImageParameters",
    "ImageToImageTargetSize",
    "ImageToTextEarlyStoppingEnum",
    "ImageToTextGenerationParameters",
    "ImageToTextInput",
    "ImageToTextOutput",
    "ImageToTextParameters",
    "InferenceApi",
    "InferenceClient",
    "InferenceEndpoint",
    "InferenceEndpointError",
    "InferenceEndpointStatus",
    "InferenceEndpointTimeoutError",
    "InferenceEndpointType",
    "InferenceTimeoutError",
    "KerasModelHubMixin",
    "MCPClient",
    "ModelCard",
    "ModelCardData",
    "ModelHubMixin",
    "ModelInfo",
    "OAuthInfo",
    "OAuthOrgInfo",
    "OAuthUserInfo",
    "ObjectDetectionBoundingBox",
    "ObjectDetectionInput",
    "ObjectDetectionOutputElement",
    "ObjectDetectionParameters",
    "PYTORCH_WEIGHTS_NAME",
    "Padding",
    "PyTorchModelHubMixin",
    "QuestionAnsweringInput",
    "QuestionAnsweringInputData",
    "QuestionAnsweringOutputElement",
    "QuestionAnsweringParameters",
    "REPO_TYPE_DATASET",
    "REPO_TYPE_MODEL",
    "REPO_TYPE_SPACE",
    "RepoCard",
    "RepoUrl",
    "Repository",
    "SentenceSimilarityInput",
    "SentenceSimilarityInputData",
    "SpaceCard",
    "SpaceCardData",
    "SpaceHardware",
    "SpaceInfo",
    "SpaceRuntime",
    "SpaceStage",
    "SpaceStorage",
    "SpaceVariable",
    "StateDictSplit",
    "SummarizationInput",
    "SummarizationOutput",
    "SummarizationParameters",
    "SummarizationTruncationStrategy",
    "TF2_WEIGHTS_NAME",
    "TF_WEIGHTS_NAME",
    "TableQuestionAnsweringInput",
    "TableQuestionAnsweringInputData",
    "TableQuestionAnsweringOutputElement",
    "TableQuestionAnsweringParameters",
    "Text2TextGenerationInput",
    "Text2TextGenerationOutput",
    "Text2TextGenerationParameters",
    "Text2TextGenerationTruncationStrategy",
    "TextClassificationInput",
    "TextClassificationOutputElement",
    "TextClassificationOutputTransform",
    "TextClassificationParameters",
    "TextGenerationInput",
    "TextGenerationInputGenerateParameters",
    "TextGenerationInputGrammarType",
    "TextGenerationOutput",
    "TextGenerationOutputBestOfSequence",
    "TextGenerationOutputDetails",
    "TextGenerationOutputFinishReason",
    "TextGenerationOutputPrefillToken",
    "TextGenerationOutputToken",
    "TextGenerationStreamOutput",
    "TextGenerationStreamOutputStreamDetails",
    "TextGenerationStreamOutputToken",
    "TextToAudioEarlyStoppingEnum",
    "TextToAudioGenerationParameters",
    "TextToAudioInput",
    "TextToAudioOutput",
    "TextToAudioParameters",
    "TextToImageInput",
    "TextToImageOutput",
    "TextToImageParameters",
    "TextToSpeechEarlyStoppingEnum",
    "TextToSpeechGenerationParameters",
    "TextToSpeechInput",
    "TextToSpeechOutput",
    "TextToSpeechParameters",
    "TextToVideoInput",
    "TextToVideoOutput",
    "TextToVideoParameters",
    "TokenClassificationAggregationStrategy",
    "TokenClassificationInput",
    "TokenClassificationOutputElement",
    "TokenClassificationParameters",
    "TranslationInput",
    "TranslationOutput",
    "TranslationParameters",
    "TranslationTruncationStrategy",
    "TypeEnum",
    "User",
    "UserLikes",
    "VideoClassificationInput",
    "VideoClassificationOutputElement",
    "VideoClassificationOutputTransform",
    "VideoClassificationParameters",
    "VisualQuestionAnsweringInput",
    "VisualQuestionAnsweringInputData",
    "VisualQuestionAnsweringOutputElement",
    "VisualQuestionAnsweringParameters",
    "WebhookInfo",
    "WebhookPayload",
    "WebhookPayloadComment",
    "WebhookPayloadDiscussion",
    "WebhookPayloadDiscussionChanges",
    "WebhookPayloadEvent",
    "WebhookPayloadMovedTo",
    "WebhookPayloadRepo",
    "WebhookPayloadUrl",
    "WebhookPayloadWebhook",
    "WebhookWatchedItem",
    "WebhooksServer",
    "ZeroShotClassificationInput",
    "ZeroShotClassificationOutputElement",
    "ZeroShotClassificationParameters",
    "ZeroShotImageClassificationInput",
    "ZeroShotImageClassificationOutputElement",
    "ZeroShotImageClassificationParameters",
    "ZeroShotObjectDetectionBoundingBox",
    "ZeroShotObjectDetectionInput",
    "ZeroShotObjectDetectionOutputElement",
    "ZeroShotObjectDetectionParameters",
    "_CACHED_NO_EXIST",
    "_save_pretrained_fastai",
    "accept_access_request",
    "add_collection_item",
    "add_space_secret",
    "add_space_variable",
    "attach_huggingface_oauth",
    "auth_check",
    "auth_list",
    "auth_switch",
    "cached_assets_path",
    "cancel_access_request",
    "change_discussion_status",
    "comment_discussion",
    "configure_http_backend",
    "create_branch",
    "create_collection",
    "create_commit",
    "create_discussion",
    "create_inference_endpoint",
    "create_inference_endpoint_from_catalog",
    "create_pull_request",
    "create_repo",
    "create_tag",
    "create_webhook",
    "dataset_info",
    "delete_branch",
    "delete_collection",
    "delete_collection_item",
    "delete_file",
    "delete_folder",
    "delete_inference_endpoint",
    "delete_repo",
    "delete_space_secret",
    "delete_space_storage",
    "delete_space_variable",
    "delete_tag",
    "delete_webhook",
    "disable_webhook",
    "dump_environment_info",
    "duplicate_space",
    "edit_discussion_comment",
    "enable_webhook",
    "export_entries_as_dduf",
    "export_folder_as_dduf",
    "file_exists",
    "from_pretrained_fastai",
    "from_pretrained_keras",
    "get_collection",
    "get_dataset_tags",
    "get_discussion_details",
    "get_full_repo_name",
    "get_hf_file_metadata",
    "get_inference_endpoint",
    "get_model_tags",
    "get_paths_info",
    "get_repo_discussions",
    "get_safetensors_metadata",
    "get_session",
    "get_space_runtime",
    "get_space_variables",
    "get_tf_storage_size",
    "get_token",
    "get_token_permission",
    "get_torch_storage_id",
    "get_torch_storage_size",
    "get_user_overview",
    "get_webhook",
    "grant_access",
    "hf_hub_download",
    "hf_hub_url",
    "interpreter_login",
    "list_accepted_access_requests",
    "list_collections",
    "list_datasets",
    "list_inference_catalog",
    "list_inference_endpoints",
    "list_lfs_files",
    "list_liked_repos",
    "list_models",
    "list_organization_members",
    "list_papers",
    "list_pending_access_requests",
    "list_rejected_access_requests",
    "list_repo_commits",
    "list_repo_files",
    "list_repo_likers",
    "list_repo_refs",
    "list_repo_tree",
    "list_spaces",
    "list_user_followers",
    "list_user_following",
    "list_webhooks",
    "load_state_dict_from_file",
    "load_torch_model",
    "logging",
    "login",
    "logout",
    "merge_pull_request",
    "metadata_eval_result",
    "metadata_load",
    "metadata_save",
    "metadata_update",
    "model_info",
    "move_repo",
    "notebook_login",
    "paper_info",
    "parse_huggingface_oauth",
    "parse_safetensors_file_metadata",
    "pause_inference_endpoint",
    "pause_space",
    "permanently_delete_lfs_files",
    "preupload_lfs_files",
    "push_to_hub_fastai",
    "push_to_hub_keras",
    "read_dduf_file",
    "reject_access_request",
    "rename_discussion",
    "repo_exists",
    "repo_info",
    "repo_type_and_id_from_hf_id",
    "request_space_hardware",
    "request_space_storage",
    "restart_space",
    "resume_inference_endpoint",
    "revision_exists",
    "run_as_future",
    "save_pretrained_keras",
    "save_torch_model",
    "save_torch_state_dict",
    "scale_to_zero_inference_endpoint",
    "scan_cache_dir",
    "set_space_sleep_time",
    "snapshot_download",
    "space_info",
    "split_state_dict_into_shards_factory",
    "split_tf_state_dict_into_shards",
    "split_torch_state_dict_into_shards",
    "super_squash_history",
    "try_to_load_from_cache",
    "unlike",
    "update_collection_item",
    "update_collection_metadata",
    "update_inference_endpoint",
    "update_repo_settings",
    "update_repo_visibility",
    "update_webhook",
    "upload_file",
    "upload_folder",
    "upload_large_folder",
    "webhook_endpoint",
    "whoami",
]


def _attach(package_name, submodules=None, submod_attrs=None):
    """Attach lazily loaded submodules, functions, or other attributes.

    Typically, modules import submodules and attributes as follows:

    ```py
    import mysubmodule
    import anothersubmodule

    from .foo import someattr
    ```

    The idea is to replace a package's `__getattr__`, `__dir__`, such that all imports
    work exactly the way they would with normal imports, except that the import occurs
    upon first use.

    The typical way to call this function, replacing the above imports, is:

    ```python
    __getattr__, __dir__ = lazy.attach(
        __name__,
        ['mysubmodule', 'anothersubmodule'],
        {'foo': ['someattr']}
    )
    ```
    This functionality requires Python 3.7 or higher.

    Args:
        package_name (`str`):
            Typically use `__name__`.
        submodules (`set`):
            List of submodules to attach.
        submod_attrs (`dict`):
            Dictionary of submodule -> list of attributes / functions.
            These attributes are imported as they are used.

    Returns:
        __getattr__, __dir__, __all__

    """
    if submod_attrs is None:
        submod_attrs = {}

    if submodules is None:
        submodules = set()
    else:
        submodules = set(submodules)

    attr_to_modules = {attr: mod for mod, attrs in submod_attrs.items() for attr in attrs}

    def __getattr__(name):
        if name in submodules:
            try:
                return importlib.import_module(f"{package_name}.{name}")
            except Exception as e:
                print(f"Error importing {package_name}.{name}: {e}")
                raise
        elif name in attr_to_modules:
            submod_path = f"{package_name}.{attr_to_modules[name]}"
            try:
                submod = importlib.import_module(submod_path)
            except Exception as e:
                print(f"Error importing {submod_path}: {e}")
                raise
            attr = getattr(submod, name)

            # If the attribute lives in a file (module) with the same
            # name as the attribute, ensure that the attribute and *not*
            # the module is accessible on the package.
            if name == attr_to_modules[name]:
                pkg = sys.modules[package_name]
                pkg.__dict__[name] = attr

            return attr
        else:
            raise AttributeError(f"No {package_name} attribute {name}")

    def __dir__():
        return __all__

    return __getattr__, __dir__


__getattr__, __dir__ = _attach(__name__, submodules=[], submod_attrs=_SUBMOD_ATTRS)

if os.environ.get("EAGER_IMPORT", ""):
    for attr in __all__:
        __getattr__(attr)

# WARNING: any content below this statement is generated automatically. Any manual edit
# will be lost when re-generating this file !
#
# To update the static imports, please run the following command and commit the changes.
# ```
# # Use script
# python utils/check_static_imports.py --update
#
# # Or run style on codebase
# make style
# ```
if TYPE_CHECKING:  # pragma: no cover
    from ._commit_scheduler import CommitScheduler  # noqa: F401
    from ._inference_endpoints import InferenceEndpoint  # noqa: F401
    from ._inference_endpoints import InferenceEndpointError  # noqa: F401
    from ._inference_endpoints import InferenceEndpointStatus  # noqa: F401
    from ._inference_endpoints import \
        InferenceEndpointTimeoutError  # noqa: F401
    from ._inference_endpoints import InferenceEndpointType  # noqa: F401
    from ._login import auth_list  # noqa: F401
    from ._login import auth_switch  # noqa: F401
    from ._login import interpreter_login  # noqa: F401
    from ._login import login  # noqa: F401
    from ._login import logout  # noqa: F401
    from ._login import notebook_login  # noqa: F401
    from ._oauth import OAuthInfo  # noqa: F401
    from ._oauth import OAuthOrgInfo  # noqa: F401
    from ._oauth import OAuthUserInfo  # noqa: F401
    from ._oauth import attach_huggingface_oauth  # noqa: F401
    from ._oauth import parse_huggingface_oauth  # noqa: F401
    from ._snapshot_download import snapshot_download  # noqa: F401
    from ._space_api import SpaceHardware  # noqa: F401
    from ._space_api import SpaceRuntime  # noqa: F401
    from ._space_api import SpaceStage  # noqa: F401
    from ._space_api import SpaceStorage  # noqa: F401
    from ._space_api import SpaceVariable  # noqa: F401
    from ._tensorboard_logger import HFSummaryWriter  # noqa: F401
    from ._webhooks_payload import WebhookPayload  # noqa: F401
    from ._webhooks_payload import WebhookPayloadComment  # noqa: F401
    from ._webhooks_payload import WebhookPayloadDiscussion  # noqa: F401
    from ._webhooks_payload import \
        WebhookPayloadDiscussionChanges  # noqa: F401
    from ._webhooks_payload import WebhookPayloadEvent  # noqa: F401
    from ._webhooks_payload import WebhookPayloadMovedTo  # noqa: F401
    from ._webhooks_payload import WebhookPayloadRepo  # noqa: F401
    from ._webhooks_payload import WebhookPayloadUrl  # noqa: F401
    from ._webhooks_payload import WebhookPayloadWebhook  # noqa: F401
    from ._webhooks_server import WebhooksServer  # noqa: F401
    from ._webhooks_server import webhook_endpoint  # noqa: F401
    from .community import Discussion  # noqa: F401
    from .community import DiscussionComment  # noqa: F401
    from .community import DiscussionCommit  # noqa: F401
    from .community import DiscussionEvent  # noqa: F401
    from .community import DiscussionStatusChange  # noqa: F401
    from .community import DiscussionTitleChange  # noqa: F401
    from .community import DiscussionWithDetails  # noqa: F401
    from .constants import CONFIG_NAME  # noqa: F401
    from .constants import FLAX_WEIGHTS_NAME  # noqa: F401
    from .constants import HUGGINGFACE_CO_URL_HOME  # noqa: F401
    from .constants import HUGGINGFACE_CO_URL_TEMPLATE  # noqa: F401
    from .constants import PYTORCH_WEIGHTS_NAME  # noqa: F401
    from .constants import REPO_TYPE_DATASET  # noqa: F401
    from .constants import REPO_TYPE_MODEL  # noqa: F401
    from .constants import REPO_TYPE_SPACE  # noqa: F401
    from .constants import TF2_WEIGHTS_NAME  # noqa: F401
    from .constants import TF_WEIGHTS_NAME  # noqa: F401
    from .fastai_utils import _save_pretrained_fastai  # noqa: F401
    from .fastai_utils import from_pretrained_fastai  # noqa: F401
    from .fastai_utils import push_to_hub_fastai  # noqa: F401
    from .file_download import _CACHED_NO_EXIST  # noqa: F401
    from .file_download import HfFileMetadata  # noqa: F401
    from .file_download import get_hf_file_metadata  # noqa: F401
    from .file_download import hf_hub_download  # noqa: F401
    from .file_download import hf_hub_url  # noqa: F401
    from .file_download import try_to_load_from_cache  # noqa: F401
    from .hf_api import Collection  # noqa: F401
    from .hf_api import CollectionItem  # noqa: F401
    from .hf_api import CommitInfo  # noqa: F401
    from .hf_api import CommitOperation  # noqa: F401
    from .hf_api import CommitOperationAdd  # noqa: F401
    from .hf_api import CommitOperationCopy  # noqa: F401
    from .hf_api import CommitOperationDelete  # noqa: F401
    from .hf_api import DatasetInfo  # noqa: F401
    from .hf_api import GitCommitInfo  # noqa: F401
    from .hf_api import GitRefInfo  # noqa: F401
    from .hf_api import GitRefs  # noqa: F401
    from .hf_api import HfApi  # noqa: F401
    from .hf_api import ModelInfo  # noqa: F401
    from .hf_api import RepoUrl  # noqa: F401
    from .hf_api import SpaceInfo  # noqa: F401
    from .hf_api import User  # noqa: F401
    from .hf_api import UserLikes  # noqa: F401
    from .hf_api import WebhookInfo  # noqa: F401
    from .hf_api import WebhookWatchedItem  # noqa: F401
    from .hf_api import accept_access_request  # noqa: F401
    from .hf_api import add_collection_item  # noqa: F401
    from .hf_api import add_space_secret  # noqa: F401
    from .hf_api import add_space_variable  # noqa: F401
    from .hf_api import auth_check  # noqa: F401
    from .hf_api import cancel_access_request  # noqa: F401
    from .hf_api import change_discussion_status  # noqa: F401
    from .hf_api import comment_discussion  # noqa: F401
    from .hf_api import create_branch  # noqa: F401
    from .hf_api import create_collection  # noqa: F401
    from .hf_api import create_commit  # noqa: F401
    from .hf_api import create_discussion  # noqa: F401
    from .hf_api import create_inference_endpoint  # noqa: F401
    from .hf_api import create_inference_endpoint_from_catalog  # noqa: F401
    from .hf_api import create_pull_request  # noqa: F401
    from .hf_api import create_repo  # noqa: F401
    from .hf_api import create_tag  # noqa: F401
    from .hf_api import create_webhook  # noqa: F401
    from .hf_api import dataset_info  # noqa: F401
    from .hf_api import delete_branch  # noqa: F401
    from .hf_api import delete_collection  # noqa: F401
    from .hf_api import delete_collection_item  # noqa: F401
    from .hf_api import delete_file  # noqa: F401
    from .hf_api import delete_folder  # noqa: F401
    from .hf_api import delete_inference_endpoint  # noqa: F401
    from .hf_api import delete_repo  # noqa: F401
    from .hf_api import delete_space_secret  # noqa: F401
    from .hf_api import delete_space_storage  # noqa: F401
    from .hf_api import delete_space_variable  # noqa: F401
    from .hf_api import delete_tag  # noqa: F401
    from .hf_api import delete_webhook  # noqa: F401
    from .hf_api import disable_webhook  # noqa: F401
    from .hf_api import duplicate_space  # noqa: F401
    from .hf_api import edit_discussion_comment  # noqa: F401
    from .hf_api import enable_webhook  # noqa: F401
    from .hf_api import file_exists  # noqa: F401
    from .hf_api import get_collection  # noqa: F401
    from .hf_api import get_dataset_tags  # noqa: F401
    from .hf_api import get_discussion_details  # noqa: F401
    from .hf_api import get_full_repo_name  # noqa: F401
    from .hf_api import get_inference_endpoint  # noqa: F401
    from .hf_api import get_model_tags  # noqa: F401
    from .hf_api import get_paths_info  # noqa: F401
    from .hf_api import get_repo_discussions  # noqa: F401
    from .hf_api import get_safetensors_metadata  # noqa: F401
    from .hf_api import get_space_runtime  # noqa: F401
    from .hf_api import get_space_variables  # noqa: F401
    from .hf_api import get_token_permission  # noqa: F401
    from .hf_api import get_user_overview  # noqa: F401
    from .hf_api import get_webhook  # noqa: F401
    from .hf_api import grant_access  # noqa: F401
    from .hf_api import list_accepted_access_requests  # noqa: F401
    from .hf_api import list_collections  # noqa: F401
    from .hf_api import list_datasets  # noqa: F401
    from .hf_api import list_inference_catalog  # noqa: F401
    from .hf_api import list_inference_endpoints  # noqa: F401
    from .hf_api import list_lfs_files  # noqa: F401
    from .hf_api import list_liked_repos  # noqa: F401
    from .hf_api import list_models  # noqa: F401
    from .hf_api import list_organization_members  # noqa: F401
    from .hf_api import list_papers  # noqa: F401
    from .hf_api import list_pending_access_requests  # noqa: F401
    from .hf_api import list_rejected_access_requests  # noqa: F401
    from .hf_api import list_repo_commits  # noqa: F401
    from .hf_api import list_repo_files  # noqa: F401
    from .hf_api import list_repo_likers  # noqa: F401
    from .hf_api import list_repo_refs  # noqa: F401
    from .hf_api import list_repo_tree  # noqa: F401
    from .hf_api import list_spaces  # noqa: F401
    from .hf_api import list_user_followers  # noqa: F401
    from .hf_api import list_user_following  # noqa: F401
    from .hf_api import list_webhooks  # noqa: F401
    from .hf_api import merge_pull_request  # noqa: F401
    from .hf_api import model_info  # noqa: F401
    from .hf_api import move_repo  # noqa: F401
    from .hf_api import paper_info  # noqa: F401
    from .hf_api import parse_safetensors_file_metadata  # noqa: F401
    from .hf_api import pause_inference_endpoint  # noqa: F401
    from .hf_api import pause_space  # noqa: F401
    from .hf_api import permanently_delete_lfs_files  # noqa: F401
    from .hf_api import preupload_lfs_files  # noqa: F401
    from .hf_api import reject_access_request  # noqa: F401
    from .hf_api import rename_discussion  # noqa: F401
    from .hf_api import repo_exists  # noqa: F401
    from .hf_api import repo_info  # noqa: F401
    from .hf_api import repo_type_and_id_from_hf_id  # noqa: F401
    from .hf_api import request_space_hardware  # noqa: F401
    from .hf_api import request_space_storage  # noqa: F401
    from .hf_api import restart_space  # noqa: F401
    from .hf_api import resume_inference_endpoint  # noqa: F401
    from .hf_api import revision_exists  # noqa: F401
    from .hf_api import run_as_future  # noqa: F401
    from .hf_api import scale_to_zero_inference_endpoint  # noqa: F401
    from .hf_api import set_space_sleep_time  # noqa: F401
    from .hf_api import space_info  # noqa: F401
    from .hf_api import super_squash_history  # noqa: F401
    from .hf_api import unlike  # noqa: F401
    from .hf_api import update_collection_item  # noqa: F401
    from .hf_api import update_collection_metadata  # noqa: F401
    from .hf_api import update_inference_endpoint  # noqa: F401
    from .hf_api import update_repo_settings  # noqa: F401
    from .hf_api import update_repo_visibility  # noqa: F401
    from .hf_api import update_webhook  # noqa: F401
    from .hf_api import upload_file  # noqa: F401
    from .hf_api import upload_folder  # noqa: F401
    from .hf_api import upload_large_folder  # noqa: F401
    from .hf_api import whoami  # noqa: F401
    from .hf_file_system import HfFileSystem  # noqa: F401
    from .hf_file_system import HfFileSystemFile  # noqa: F401
    from .hf_file_system import HfFileSystemResolvedPath  # noqa: F401
    from .hf_file_system import HfFileSystemStreamFile  # noqa: F401
    from .hub_mixin import ModelHubMixin  # noqa: F401
    from .hub_mixin import PyTorchModelHubMixin  # noqa: F401
    from .inference._client import InferenceClient  # noqa: F401
    from .inference._client import InferenceTimeoutError  # noqa: F401
    from .inference._generated._async_client import \
        AsyncInferenceClient  # noqa: F401
    from .inference._generated.types import \
        AudioClassificationInput  # noqa: F401
    from .inference._generated.types import \
        AudioClassificationOutputElement  # noqa: F401
    from .inference._generated.types import \
        AudioClassificationOutputTransform  # noqa: F401
    from .inference._generated.types import \
        AudioClassificationParameters  # noqa: F401
    from .inference._generated.types import AudioToAudioInput  # noqa: F401
    from .inference._generated.types import \
        AudioToAudioOutputElement  # noqa: F401
    from .inference._generated.types import \
        AutomaticSpeechRecognitionEarlyStoppingEnum  # noqa: F401
    from .inference._generated.types import \
        AutomaticSpeechRecognitionGenerationParameters  # noqa: F401
    from .inference._generated.types import \
        AutomaticSpeechRecognitionInput  # noqa: F401
    from .inference._generated.types import \
        AutomaticSpeechRecognitionOutput  # noqa: F401
    from .inference._generated.types import \
        AutomaticSpeechRecognitionOutputChunk  # noqa: F401
    from .inference._generated.types import \
        AutomaticSpeechRecognitionParameters  # noqa: F401
    from .inference._generated.types import ChatCompletionInput  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputFunctionDefinition  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputFunctionName  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputGrammarType  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputJSONSchema  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputMessage  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputMessageChunk  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputMessageChunkType  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputResponseFormatJSONObject  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputResponseFormatJSONSchema  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputResponseFormatText  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputStreamOptions  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputTool  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputToolCall  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputToolChoiceClass  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputToolChoiceEnum  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionInputURL  # noqa: F401
    from .inference._generated.types import ChatCompletionOutput  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionOutputComplete  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionOutputFunctionDefinition  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionOutputLogprob  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionOutputLogprobs  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionOutputMessage  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionOutputToolCall  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionOutputTopLogprob  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionOutputUsage  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionStreamOutput  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionStreamOutputChoice  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionStreamOutputDelta  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionStreamOutputDeltaToolCall  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionStreamOutputFunction  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionStreamOutputLogprob  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionStreamOutputLogprobs  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionStreamOutputTopLogprob  # noqa: F401
    from .inference._generated.types import \
        ChatCompletionStreamOutputUsage  # noqa: F401
    from .inference._generated.types import DepthEstimationInput  # noqa: F401
    from .inference._generated.types import DepthEstimationOutput  # noqa: F401
    from .inference._generated.types import \
        DocumentQuestionAnsweringInput  # noqa: F401
    from .inference._generated.types import \
        DocumentQuestionAnsweringInputData  # noqa: F401
    from .inference._generated.types import \
        DocumentQuestionAnsweringOutputElement  # noqa: F401
    from .inference._generated.types import \
        DocumentQuestionAnsweringParameters  # noqa: F401
    from .inference._generated.types import \
        FeatureExtractionInput  # noqa: F401
    from .inference._generated.types import \
        FeatureExtractionInputTruncationDirection  # noqa: F401
    from .inference._generated.types import FillMaskInput  # noqa: F401
    from .inference._generated.types import FillMaskOutputElement  # noqa: F401
    from .inference._generated.types import FillMaskParameters  # noqa: F401
    from .inference._generated.types import \
        ImageClassificationInput  # noqa: F401
    from .inference._generated.types import \
        ImageClassificationOutputElement  # noqa: F401
    from .inference._generated.types import \
        ImageClassificationOutputTransform  # noqa: F401
    from .inference._generated.types import \
        ImageClassificationParameters  # noqa: F401
    from .inference._generated.types import \
        ImageSegmentationInput  # noqa: F401
    from .inference._generated.types import \
        ImageSegmentationOutputElement  # noqa: F401
    from .inference._generated.types import \
        ImageSegmentationParameters  # noqa: F401
    from .inference._generated.types import \
        ImageSegmentationSubtask  # noqa: F401
    from .inference._generated.types import ImageToImageInput  # noqa: F401
    from .inference._generated.types import ImageToImageOutput  # noqa: F401
    from .inference._generated.types import \
        ImageToImageParameters  # noqa: F401
    from .inference._generated.types import \
        ImageToImageTargetSize  # noqa: F401
    from .inference._generated.types import \
        ImageToTextEarlyStoppingEnum  # noqa: F401
    from .inference._generated.types import \
        ImageToTextGenerationParameters  # noqa: F401
    from .inference._generated.types import ImageToTextInput  # noqa: F401
    from .inference._generated.types import ImageToTextOutput  # noqa: F401
    from .inference._generated.types import ImageToTextParameters  # noqa: F401
    from .inference._generated.types import \
        ObjectDetectionBoundingBox  # noqa: F401
    from .inference._generated.types import ObjectDetectionInput  # noqa: F401
    from .inference._generated.types import \
        ObjectDetectionOutputElement  # noqa: F401
    from .inference._generated.types import \
        ObjectDetectionParameters  # noqa: F401
    from .inference._generated.types import Padding  # noqa: F401
    from .inference._generated.types import \
        QuestionAnsweringInput  # noqa: F401
    from .inference._generated.types import \
        QuestionAnsweringInputData  # noqa: F401
    from .inference._generated.types import \
        QuestionAnsweringOutputElement  # noqa: F401
    from .inference._generated.types import \
        QuestionAnsweringParameters  # noqa: F401
    from .inference._generated.types import \
        SentenceSimilarityInput  # noqa: F401
    from .inference._generated.types import \
        SentenceSimilarityInputData  # noqa: F401
    from .inference._generated.types import SummarizationInput  # noqa: F401
    from .inference._generated.types import SummarizationOutput  # noqa: F401
    from .inference._generated.types import \
        SummarizationParameters  # noqa: F401
    from .inference._generated.types import \
        SummarizationTruncationStrategy  # noqa: F401
    from .inference._generated.types import \
        TableQuestionAnsweringInput  # noqa: F401
    from .inference._generated.types import \
        TableQuestionAnsweringInputData  # noqa: F401
    from .inference._generated.types import \
        TableQuestionAnsweringOutputElement  # noqa: F401
    from .inference._generated.types import \
        TableQuestionAnsweringParameters  # noqa: F401
    from .inference._generated.types import \
        Text2TextGenerationInput  # noqa: F401
    from .inference._generated.types import \
        Text2TextGenerationOutput  # noqa: F401
    from .inference._generated.types import \
        Text2TextGenerationParameters  # noqa: F401
    from .inference._generated.types import \
        Text2TextGenerationTruncationStrategy  # noqa: F401
    from .inference._generated.types import \
        TextClassificationInput  # noqa: F401
    from .inference._generated.types import \
        TextClassificationOutputElement  # noqa: F401
    from .inference._generated.types import \
        TextClassificationOutputTransform  # noqa: F401
    from .inference._generated.types import \
        TextClassificationParameters  # noqa: F401
    from .inference._generated.types import TextGenerationInput  # noqa: F401
    from .inference._generated.types import \
        TextGenerationInputGenerateParameters  # noqa: F401
    from .inference._generated.types import \
        TextGenerationInputGrammarType  # noqa: F401
    from .inference._generated.types import TextGenerationOutput  # noqa: F401
    from .inference._generated.types import \
        TextGenerationOutputBestOfSequence  # noqa: F401
    from .inference._generated.types import \
        TextGenerationOutputDetails  # noqa: F401
    from .inference._generated.types import \
        TextGenerationOutputFinishReason  # noqa: F401
    from .inference._generated.types import \
        TextGenerationOutputPrefillToken  # noqa: F401
    from .inference._generated.types import \
        TextGenerationOutputToken  # noqa: F401
    from .inference._generated.types import \
        TextGenerationStreamOutput  # noqa: F401
    from .inference._generated.types import \
        TextGenerationStreamOutputStreamDetails  # noqa: F401
    from .inference._generated.types import \
        TextGenerationStreamOutputToken  # noqa: F401
    from .inference._generated.types import \
        TextToAudioEarlyStoppingEnum  # noqa: F401
    from .inference._generated.types import \
        TextToAudioGenerationParameters  # noqa: F401
    from .inference._generated.types import TextToAudioInput  # noqa: F401
    from .inference._generated.types import TextToAudioOutput  # noqa: F401
    from .inference._generated.types import TextToAudioParameters  # noqa: F401
    from .inference._generated.types import TextToImageInput  # noqa: F401
    from .inference._generated.types import TextToImageOutput  # noqa: F401
    from .inference._generated.types import TextToImageParameters  # noqa: F401
    from .inference._generated.types import \
        TextToSpeechEarlyStoppingEnum  # noqa: F401
    from .inference._generated.types import \
        TextToSpeechGenerationParameters  # noqa: F401
    from .inference._generated.types import TextToSpeechInput  # noqa: F401
    from .inference._generated.types import TextToSpeechOutput  # noqa: F401
    from .inference._generated.types import \
        TextToSpeechParameters  # noqa: F401
    from .inference._generated.types import TextToVideoInput  # noqa: F401
    from .inference._generated.types import TextToVideoOutput  # noqa: F401
    from .inference._generated.types import TextToVideoParameters  # noqa: F401
    from .inference._generated.types import \
        TokenClassificationAggregationStrategy  # noqa: F401
    from .inference._generated.types import \
        TokenClassificationInput  # noqa: F401
    from .inference._generated.types import \
        TokenClassificationOutputElement  # noqa: F401
    from .inference._generated.types import \
        TokenClassificationParameters  # noqa: F401
    from .inference._generated.types import TranslationInput  # noqa: F401
    from .inference._generated.types import TranslationOutput  # noqa: F401
    from .inference._generated.types import TranslationParameters  # noqa: F401
    from .inference._generated.types import \
        TranslationTruncationStrategy  # noqa: F401
    from .inference._generated.types import TypeEnum  # noqa: F401
    from .inference._generated.types import \
        VideoClassificationInput  # noqa: F401
    from .inference._generated.types import \
        VideoClassificationOutputElement  # noqa: F401
    from .inference._generated.types import \
        VideoClassificationOutputTransform  # noqa: F401
    from .inference._generated.types import \
        VideoClassificationParameters  # noqa: F401
    from .inference._generated.types import \
        VisualQuestionAnsweringInput  # noqa: F401
    from .inference._generated.types import \
        VisualQuestionAnsweringInputData  # noqa: F401
    from .inference._generated.types import \
        VisualQuestionAnsweringOutputElement  # noqa: F401
    from .inference._generated.types import \
        VisualQuestionAnsweringParameters  # noqa: F401
    from .inference._generated.types import \
        ZeroShotClassificationInput  # noqa: F401
    from .inference._generated.types import \
        ZeroShotClassificationOutputElement  # noqa: F401
    from .inference._generated.types import \
        ZeroShotClassificationParameters  # noqa: F401
    from .inference._generated.types import \
        ZeroShotImageClassificationInput  # noqa: F401
    from .inference._generated.types import \
        ZeroShotImageClassificationOutputElement  # noqa: F401
    from .inference._generated.types import \
        ZeroShotImageClassificationParameters  # noqa: F401
    from .inference._generated.types import \
        ZeroShotObjectDetectionBoundingBox  # noqa: F401
    from .inference._generated.types import \
        ZeroShotObjectDetectionInput  # noqa: F401
    from .inference._generated.types import \
        ZeroShotObjectDetectionOutputElement  # noqa: F401
    from .inference._generated.types import \
        ZeroShotObjectDetectionParameters  # noqa: F401
    from .inference._mcp.agent import Agent  # noqa: F401
    from .inference._mcp.mcp_client import MCPClient  # noqa: F401
    from .inference_api import InferenceApi  # noqa: F401
    from .keras_mixin import KerasModelHubMixin  # noqa: F401
    from .keras_mixin import from_pretrained_keras  # noqa: F401
    from .keras_mixin import push_to_hub_keras  # noqa: F401
    from .keras_mixin import save_pretrained_keras  # noqa: F401
    from .repocard import DatasetCard  # noqa: F401
    from .repocard import ModelCard  # noqa: F401
    from .repocard import RepoCard  # noqa: F401
    from .repocard import SpaceCard  # noqa: F401
    from .repocard import metadata_eval_result  # noqa: F401
    from .repocard import metadata_load  # noqa: F401
    from .repocard import metadata_save  # noqa: F401
    from .repocard import metadata_update  # noqa: F401
    from .repocard_data import CardData  # noqa: F401
    from .repocard_data import DatasetCardData  # noqa: F401
    from .repocard_data import EvalResult  # noqa: F401
    from .repocard_data import ModelCardData  # noqa: F401
    from .repocard_data import SpaceCardData  # noqa: F401
    from .repository import Repository  # noqa: F401
    from .serialization import StateDictSplit  # noqa: F401
    from .serialization import get_tf_storage_size  # noqa: F401
    from .serialization import get_torch_storage_id  # noqa: F401
    from .serialization import get_torch_storage_size  # noqa: F401
    from .serialization import load_state_dict_from_file  # noqa: F401
    from .serialization import load_torch_model  # noqa: F401
    from .serialization import save_torch_model  # noqa: F401
    from .serialization import save_torch_state_dict  # noqa: F401
    from .serialization import \
        split_state_dict_into_shards_factory  # noqa: F401
    from .serialization import split_tf_state_dict_into_shards  # noqa: F401
    from .serialization import split_torch_state_dict_into_shards  # noqa: F401
    from .serialization._dduf import DDUFEntry  # noqa: F401
    from .serialization._dduf import export_entries_as_dduf  # noqa: F401
    from .serialization._dduf import export_folder_as_dduf  # noqa: F401
    from .serialization._dduf import read_dduf_file  # noqa: F401
    from .utils import CachedFileInfo  # noqa: F401
    from .utils import CachedRepoInfo  # noqa: F401
    from .utils import CachedRevisionInfo  # noqa: F401
    from .utils import CacheNotFound  # noqa: F401
    from .utils import CorruptedCacheException  # noqa: F401
    from .utils import DeleteCacheStrategy  # noqa: F401
    from .utils import HFCacheInfo  # noqa: F401
    from .utils import HfFolder  # noqa: F401
    from .utils import cached_assets_path  # noqa: F401
    from .utils import configure_http_backend  # noqa: F401
    from .utils import dump_environment_info  # noqa: F401
    from .utils import get_session  # noqa: F401
    from .utils import get_token  # noqa: F401
    from .utils import logging  # noqa: F401
    from .utils import scan_cache_dir  # noqa: F401
