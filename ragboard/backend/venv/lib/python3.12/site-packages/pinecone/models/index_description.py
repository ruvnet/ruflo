from typing import NamedTuple, Dict, Optional, Union, Literal

class IndexStatus(NamedTuple):
    state: str
    ready: bool

PodKey = Literal['pod']
class PodSpecDefinition(NamedTuple):
    replicas: int
    shards: int
    pods: int
    pod_type: str
    environment: str
    metadata_config: Optional[Dict]

PodSpec = Dict[PodKey, PodSpecDefinition]

ServerlessKey = Literal['serverless']
class ServerlessSpecDefinition(NamedTuple):
    cloud: str
    region: str

ServerlessSpec = Dict[ServerlessKey, ServerlessSpecDefinition]

class IndexDescription(NamedTuple):
    """
    The description of an index. This object is returned from the `describe_index()` method. 
    """

    name: str
    """
    The name of the index
    """

    dimension: int
    """
    The dimension of the index. This corresponds to the length of the vectors stored in the index.
    """

    metric: str
    """
    One of 'cosine', 'euclidean', or 'dotproduct'.
    """

    host: str
    """
    The endpoint you will use to connect to this index for data operations such as upsert and query.
    """

    spec: Union[PodSpec, ServerlessSpec]
    """
    The spec describes how the index is being deployed.
    """

    status: IndexStatus
    """
    Status includes information on whether the index is ready to accept data operations.
    """
