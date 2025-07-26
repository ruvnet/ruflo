# Copyright The OpenTelemetry Authors
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

from enum import Enum
from typing import Final

from typing_extensions import deprecated

GEN_AI_AGENT_DESCRIPTION: Final = "gen_ai.agent.description"
"""
Free-form description of the GenAI agent provided by the application.
"""

GEN_AI_AGENT_ID: Final = "gen_ai.agent.id"
"""
The unique identifier of the GenAI agent.
"""

GEN_AI_AGENT_NAME: Final = "gen_ai.agent.name"
"""
Human-readable name of the GenAI agent provided by the application.
"""

GEN_AI_COMPLETION: Final = "gen_ai.completion"
"""
Deprecated: Removed, no replacement at this time.
"""

GEN_AI_CONVERSATION_ID: Final = "gen_ai.conversation.id"
"""
The unique identifier for a conversation (session, thread), used to store and correlate messages within this conversation.
"""

GEN_AI_DATA_SOURCE_ID: Final = "gen_ai.data_source.id"
"""
The data source identifier.
Note: Data sources are used by AI agents and RAG applications to store grounding data. A data source may be an external database, object store, document collection, website, or any other storage system used by the GenAI agent or application. The `gen_ai.data_source.id` SHOULD match the identifier used by the GenAI system rather than a name specific to the external storage, such as a database or object store. Semantic conventions referencing `gen_ai.data_source.id` MAY also leverage additional attributes, such as `db.*`, to further identify and describe the data source.
"""

GEN_AI_OPENAI_REQUEST_RESPONSE_FORMAT: Final = (
    "gen_ai.openai.request.response_format"
)
"""
Deprecated: Replaced by `gen_ai.output.type`.
"""

GEN_AI_OPENAI_REQUEST_SEED: Final = "gen_ai.openai.request.seed"
"""
Deprecated: Replaced by `gen_ai.request.seed`.
"""

GEN_AI_OPENAI_REQUEST_SERVICE_TIER: Final = (
    "gen_ai.openai.request.service_tier"
)
"""
The service tier requested. May be a specific tier, default, or auto.
"""

GEN_AI_OPENAI_RESPONSE_SERVICE_TIER: Final = (
    "gen_ai.openai.response.service_tier"
)
"""
The service tier used for the response.
"""

GEN_AI_OPENAI_RESPONSE_SYSTEM_FINGERPRINT: Final = (
    "gen_ai.openai.response.system_fingerprint"
)
"""
A fingerprint to track any eventual change in the Generative AI environment.
"""

GEN_AI_OPERATION_NAME: Final = "gen_ai.operation.name"
"""
The name of the operation being performed.
Note: If one of the predefined values applies, but specific system uses a different name it's RECOMMENDED to document it in the semantic conventions for specific GenAI system and use system-specific name in the instrumentation. If a different name is not documented, instrumentation libraries SHOULD use applicable predefined value.
"""

GEN_AI_OUTPUT_TYPE: Final = "gen_ai.output.type"
"""
Represents the content type requested by the client.
Note: This attribute SHOULD be used when the client requests output of a specific type. The model may return zero or more outputs of this type.
This attribute specifies the output modality and not the actual output format. For example, if an image is requested, the actual output could be a URL pointing to an image file.
Additional output format details may be recorded in the future in the `gen_ai.output.{type}.*` attributes.
"""

GEN_AI_PROMPT: Final = "gen_ai.prompt"
"""
Deprecated: Removed, no replacement at this time.
"""

GEN_AI_REQUEST_CHOICE_COUNT: Final = "gen_ai.request.choice.count"
"""
The target number of candidate completions to return.
"""

GEN_AI_REQUEST_ENCODING_FORMATS: Final = "gen_ai.request.encoding_formats"
"""
The encoding formats requested in an embeddings operation, if specified.
Note: In some GenAI systems the encoding formats are called embedding types. Also, some GenAI systems only accept a single format per request.
"""

GEN_AI_REQUEST_FREQUENCY_PENALTY: Final = "gen_ai.request.frequency_penalty"
"""
The frequency penalty setting for the GenAI request.
"""

GEN_AI_REQUEST_MAX_TOKENS: Final = "gen_ai.request.max_tokens"
"""
The maximum number of tokens the model generates for a request.
"""

GEN_AI_REQUEST_MODEL: Final = "gen_ai.request.model"
"""
The name of the GenAI model a request is being made to.
"""

GEN_AI_REQUEST_PRESENCE_PENALTY: Final = "gen_ai.request.presence_penalty"
"""
The presence penalty setting for the GenAI request.
"""

GEN_AI_REQUEST_SEED: Final = "gen_ai.request.seed"
"""
Requests with same seed value more likely to return same result.
"""

GEN_AI_REQUEST_STOP_SEQUENCES: Final = "gen_ai.request.stop_sequences"
"""
List of sequences that the model will use to stop generating further tokens.
"""

GEN_AI_REQUEST_TEMPERATURE: Final = "gen_ai.request.temperature"
"""
The temperature setting for the GenAI request.
"""

GEN_AI_REQUEST_TOP_K: Final = "gen_ai.request.top_k"
"""
The top_k sampling setting for the GenAI request.
"""

GEN_AI_REQUEST_TOP_P: Final = "gen_ai.request.top_p"
"""
The top_p sampling setting for the GenAI request.
"""

GEN_AI_RESPONSE_FINISH_REASONS: Final = "gen_ai.response.finish_reasons"
"""
Array of reasons the model stopped generating tokens, corresponding to each generation received.
"""

GEN_AI_RESPONSE_ID: Final = "gen_ai.response.id"
"""
The unique identifier for the completion.
"""

GEN_AI_RESPONSE_MODEL: Final = "gen_ai.response.model"
"""
The name of the model that generated the response.
"""

GEN_AI_SYSTEM: Final = "gen_ai.system"
"""
The Generative AI product as identified by the client or server instrumentation.
Note: The `gen_ai.system` describes a family of GenAI models with specific model identified
by `gen_ai.request.model` and `gen_ai.response.model` attributes.

The actual GenAI product may differ from the one identified by the client.
Multiple systems, including Azure OpenAI and Gemini, are accessible by OpenAI client
libraries. In such cases, the `gen_ai.system` is set to `openai` based on the
instrumentation's best knowledge, instead of the actual system. The `server.address`
attribute may help identify the actual system in use for `openai`.

For custom model, a custom friendly name SHOULD be used.
If none of these options apply, the `gen_ai.system` SHOULD be set to `_OTHER`.
"""

GEN_AI_TOKEN_TYPE: Final = "gen_ai.token.type"
"""
The type of token being counted.
"""

GEN_AI_TOOL_CALL_ID: Final = "gen_ai.tool.call.id"
"""
The tool call identifier.
"""

GEN_AI_TOOL_DESCRIPTION: Final = "gen_ai.tool.description"
"""
The tool description.
"""

GEN_AI_TOOL_NAME: Final = "gen_ai.tool.name"
"""
Name of the tool utilized by the agent.
"""

GEN_AI_TOOL_TYPE: Final = "gen_ai.tool.type"
"""
Type of the tool utilized by the agent.
Note: Extension: A tool executed on the agent-side to directly call external APIs, bridging the gap between the agent and real-world systems.
  Agent-side operations involve actions that are performed by the agent on the server or within the agent's controlled environment.
Function: A tool executed on the client-side, where the agent generates parameters for a predefined function, and the client executes the logic.
  Client-side operations are actions taken on the user's end or within the client application.
Datastore: A tool used by the agent to access and query structured or unstructured external data for retrieval-augmented tasks or knowledge updates.
"""

GEN_AI_USAGE_COMPLETION_TOKENS: Final = "gen_ai.usage.completion_tokens"
"""
Deprecated: Replaced by `gen_ai.usage.output_tokens`.
"""

GEN_AI_USAGE_INPUT_TOKENS: Final = "gen_ai.usage.input_tokens"
"""
The number of tokens used in the GenAI input (prompt).
"""

GEN_AI_USAGE_OUTPUT_TOKENS: Final = "gen_ai.usage.output_tokens"
"""
The number of tokens used in the GenAI response (completion).
"""

GEN_AI_USAGE_PROMPT_TOKENS: Final = "gen_ai.usage.prompt_tokens"
"""
Deprecated: Replaced by `gen_ai.usage.input_tokens`.
"""


@deprecated(
    "The attribute gen_ai.openai.request.response_format is deprecated - Replaced by `gen_ai.output.type`"
)
class GenAiOpenaiRequestResponseFormatValues(Enum):
    TEXT = "text"
    """Text response format."""
    JSON_OBJECT = "json_object"
    """JSON object response format."""
    JSON_SCHEMA = "json_schema"
    """JSON schema response format."""


class GenAiOpenaiRequestServiceTierValues(Enum):
    AUTO = "auto"
    """The system will utilize scale tier credits until they are exhausted."""
    DEFAULT = "default"
    """The system will utilize the default scale tier."""


class GenAiOperationNameValues(Enum):
    CHAT = "chat"
    """Chat completion operation such as [OpenAI Chat API](https://platform.openai.com/docs/api-reference/chat)."""
    GENERATE_CONTENT = "generate_content"
    """Multimodal content generation operation such as [Gemini Generate Content](https://ai.google.dev/api/generate-content)."""
    TEXT_COMPLETION = "text_completion"
    """Text completions operation such as [OpenAI Completions API (Legacy)](https://platform.openai.com/docs/api-reference/completions)."""
    EMBEDDINGS = "embeddings"
    """Embeddings operation such as [OpenAI Create embeddings API](https://platform.openai.com/docs/api-reference/embeddings/create)."""
    CREATE_AGENT = "create_agent"
    """Create GenAI agent."""
    INVOKE_AGENT = "invoke_agent"
    """Invoke GenAI agent."""
    EXECUTE_TOOL = "execute_tool"
    """Execute a tool."""


class GenAiOutputTypeValues(Enum):
    TEXT = "text"
    """Plain text."""
    JSON = "json"
    """JSON object with known or unknown schema."""
    IMAGE = "image"
    """Image."""
    SPEECH = "speech"
    """Speech."""


class GenAiSystemValues(Enum):
    OPENAI = "openai"
    """OpenAI."""
    GCP_GEN_AI = "gcp.gen_ai"
    """Any Google generative AI endpoint."""
    GCP_VERTEX_AI = "gcp.vertex_ai"
    """Vertex AI."""
    GCP_GEMINI = "gcp.gemini"
    """Gemini."""
    VERTEX_AI = "vertex_ai"
    """Deprecated: Use 'gcp.vertex_ai' instead."""
    GEMINI = "gemini"
    """Deprecated: Use 'gcp.gemini' instead."""
    ANTHROPIC = "anthropic"
    """Anthropic."""
    COHERE = "cohere"
    """Cohere."""
    AZURE_AI_INFERENCE = "azure.ai.inference"
    """Azure AI Inference."""
    AZURE_AI_OPENAI = "azure.ai.openai"
    """Azure OpenAI."""
    AZ_AI_INFERENCE = "az.ai.inference"
    """Deprecated: Replaced by azure.ai.inference."""
    AZ_AI_OPENAI = "azure.ai.openai"
    """Deprecated: Replaced by azure.ai.openai."""
    IBM_WATSONX_AI = "ibm.watsonx.ai"
    """IBM Watsonx AI."""
    AWS_BEDROCK = "aws.bedrock"
    """AWS Bedrock."""
    PERPLEXITY = "perplexity"
    """Perplexity."""
    XAI = "xai"
    """xAI."""
    DEEPSEEK = "deepseek"
    """DeepSeek."""
    GROQ = "groq"
    """Groq."""
    MISTRAL_AI = "mistral_ai"
    """Mistral AI."""


class GenAiTokenTypeValues(Enum):
    INPUT = "input"
    """Input tokens (prompt, input, etc.)."""
    COMPLETION = "output"
    """Deprecated: Replaced by `output`."""
    OUTPUT = "output"
    """Output tokens (completion, response, etc.)."""
