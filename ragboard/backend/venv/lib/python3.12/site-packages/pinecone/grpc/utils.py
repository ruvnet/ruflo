import uuid

from google.protobuf.struct_pb2 import Struct

def _generate_request_id() -> str:
    return str(uuid.uuid4())

from pinecone.core.client.models import (
    Vector as _Vector,
    Usage,
    ScoredVector,
    SparseValues,
    FetchResponse,
    QueryResponse,
    DescribeIndexStatsResponse,
    NamespaceSummary,
)

from typing import Optional

def dict_to_proto_struct(d: Optional[dict]) -> "Struct":
    if not d:
        d = {}
    s = Struct()
    s.update(d)
    return s

def parse_sparse_values(sparse_values: dict):
    return (
        SparseValues(indices=sparse_values["indices"], values=sparse_values["values"])
        if sparse_values
        else SparseValues(indices=[], values=[])
    )


def parse_fetch_response(response: dict):
    vd = {}
    vectors = response.get("vectors", {})
    namespace = response.get("namespace", "")

    for id, vec in vectors.items():
        vd[id] = _Vector(
            id=vec["id"],
            values=vec["values"],
            sparse_values=parse_sparse_values(vec.get("sparseValues")),
            metadata=vec.get("metadata", None),
            _check_type=False,
        )
    
    return FetchResponse(
        vectors=vd, 
        namespace=namespace,
        usage=parse_usage(response),
        _check_type=False
    )

def parse_usage(response):
    u = response.get("usage", {})
    return Usage(read_units=int(u.get("readUnits", 0)))


def parse_query_response(response: dict, _check_type: bool = False):
    matches = []
    for item in response.get("matches", []):
        sc = ScoredVector(
            id=item["id"],
            score=item.get("score", 0.0),
            values=item.get("values", []),
            sparse_values=parse_sparse_values(item.get("sparseValues")),
            metadata=item.get("metadata", None),
            _check_type=_check_type,
        )
        matches.append(sc)

    return QueryResponse(
        namespace=response.get("namespace", ""), 
        matches=matches,
        usage = parse_usage(response),
        _check_type=_check_type
    )


def parse_stats_response(response: dict):
    fullness = response.get("indexFullness", 0.0)
    total_vector_count = response.get("totalVectorCount", 0)
    dimension = response.get("dimension", 0)
    summaries = response.get("namespaces", {})
    namespace_summaries = {}
    for key in summaries:
        vc = summaries[key].get("vectorCount", 0)
        namespace_summaries[key] = NamespaceSummary(vector_count=vc)
    return DescribeIndexStatsResponse(
        namespaces=namespace_summaries,
        dimension=dimension,
        index_fullness=fullness,
        total_vector_count=total_vector_count,
        _check_type=False,
    )
