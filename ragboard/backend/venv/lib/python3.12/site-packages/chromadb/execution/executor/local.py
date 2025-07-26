from typing import Optional, Sequence

from overrides import overrides

from chromadb.api.types import GetResult, Metadata, QueryResult
from chromadb.config import System
from chromadb.execution.executor.abstract import Executor
from chromadb.execution.expression.plan import CountPlan, GetPlan, KNNPlan
from chromadb.segment import MetadataReader, VectorReader
from chromadb.segment.impl.manager.local import LocalSegmentManager
from chromadb.types import Collection, VectorQuery, VectorQueryResult


def _clean_metadata(metadata: Optional[Metadata]) -> Optional[Metadata]:
    """Remove any chroma-specific metadata keys that the client shouldn't see from a metadata map."""
    if not metadata:
        return None
    result = {}
    for k, v in metadata.items():
        if not k.startswith("chroma:"):
            result[k] = v
    if len(result) == 0:
        return None
    return result


def _doc(metadata: Optional[Metadata]) -> Optional[str]:
    """Retrieve the document (if any) from a Metadata map"""

    if metadata and "chroma:document" in metadata:
        return str(metadata["chroma:document"])
    return None


def _uri(metadata: Optional[Metadata]) -> Optional[str]:
    """Retrieve the uri (if any) from a Metadata map"""

    if metadata and "chroma:uri" in metadata:
        return str(metadata["chroma:uri"])
    return None


class LocalExecutor(Executor):
    _manager: LocalSegmentManager

    def __init__(self, system: System):
        super().__init__(system)
        self._manager = self.require(LocalSegmentManager)

    @overrides
    def count(self, plan: CountPlan) -> int:
        return self._metadata_segment(plan.scan.collection).count(plan.scan.version)

    @overrides
    def get(self, plan: GetPlan) -> GetResult:
        records = self._metadata_segment(plan.scan.collection).get_metadata(
            request_version_context=plan.scan.version,
            where=plan.filter.where,
            where_document=plan.filter.where_document,
            ids=plan.filter.user_ids,
            limit=plan.limit.fetch,
            offset=plan.limit.skip,
            include_metadata=True,
        )

        ids = [r["id"] for r in records]
        embeddings = None
        documents = None
        uris = None
        metadatas = None
        included = list()

        if plan.projection.embedding:
            if len(records) > 0:
                vectors = self._vector_segment(plan.scan.collection).get_vectors(
                    ids=ids, request_version_context=plan.scan.version
                )
                embeddings = [v["embedding"] for v in vectors]
            else:
                embeddings = list()
            included.append("embeddings")

        if plan.projection.document:
            documents = [_doc(r["metadata"]) for r in records]
            included.append("documents")

        if plan.projection.uri:
            uris = [_uri(r["metadata"]) for r in records]
            included.append("uris")

        if plan.projection.metadata:
            metadatas = [_clean_metadata(r["metadata"]) for r in records]
            included.append("metadatas")

        # TODO: Fix typing
        return GetResult(
            ids=ids,
            embeddings=embeddings,
            documents=documents,  # type: ignore[typeddict-item]
            uris=uris,  # type: ignore[typeddict-item]
            data=None,
            metadatas=metadatas,  # type: ignore[typeddict-item]
            included=included,
        )

    @overrides
    def knn(self, plan: KNNPlan) -> QueryResult:
        prefiltered_ids = None
        if plan.filter.user_ids or plan.filter.where or plan.filter.where_document:
            records = self._metadata_segment(plan.scan.collection).get_metadata(
                request_version_context=plan.scan.version,
                where=plan.filter.where,
                where_document=plan.filter.where_document,
                ids=plan.filter.user_ids,
                limit=None,
                offset=0,
                include_metadata=False,
            )
            prefiltered_ids = [r["id"] for r in records]

        knns: Sequence[Sequence[VectorQueryResult]] = [[]] * len(plan.knn.embeddings)

        # Query vectors only when the user did not specify a filter or when the filter
        # yields non-empty ids. Otherwise, the user specified a filter but it yields
        # no matching ids, in which case we can return an empty result.
        if prefiltered_ids is None or len(prefiltered_ids) > 0:
            query = VectorQuery(
                vectors=plan.knn.embeddings,
                k=plan.knn.fetch,
                allowed_ids=prefiltered_ids,
                include_embeddings=plan.projection.embedding,
                options=None,
                request_version_context=plan.scan.version,
            )
            knns = self._vector_segment(plan.scan.collection).query_vectors(query)

        ids = [[r["id"] for r in result] for result in knns]
        embeddings = None
        documents = None
        uris = None
        metadatas = None
        distances = None
        included = list()

        if plan.projection.embedding:
            embeddings = [[r["embedding"] for r in result] for result in knns]
            included.append("embeddings")

        if plan.projection.rank:
            distances = [[r["distance"] for r in result] for result in knns]
            included.append("distances")

        if plan.projection.document or plan.projection.metadata or plan.projection.uri:
            merged_ids = list(set([id for result in ids for id in result]))
            hydrated_records = self._metadata_segment(
                plan.scan.collection
            ).get_metadata(
                request_version_context=plan.scan.version,
                where=None,
                where_document=None,
                ids=merged_ids,
                limit=None,
                offset=0,
                include_metadata=True,
            )
            metadata_by_id = {r["id"]: r["metadata"] for r in hydrated_records}

            if plan.projection.document:
                documents = [
                    [_doc(metadata_by_id.get(id, None)) for id in result]
                    for result in ids
                ]
                included.append("documents")

            if plan.projection.uri:
                uris = [
                    [_uri(metadata_by_id.get(id, None)) for id in result]
                    for result in ids
                ]
                included.append("uris")

            if plan.projection.metadata:
                metadatas = [
                    [_clean_metadata(metadata_by_id.get(id, None)) for id in result]
                    for result in ids
                ]
                included.append("metadatas")

        # TODO: Fix typing
        return QueryResult(
            ids=ids,
            embeddings=embeddings,  # type: ignore[typeddict-item]
            documents=documents,  # type: ignore[typeddict-item]
            uris=uris,  # type: ignore[typeddict-item]
            data=None,
            metadatas=metadatas,  # type: ignore[typeddict-item]
            distances=distances,
            included=included,
        )

    def _metadata_segment(self, collection: Collection) -> MetadataReader:
        return self._manager.get_segment(collection.id, MetadataReader)

    def _vector_segment(self, collection: Collection) -> VectorReader:
        return self._manager.get_segment(collection.id, VectorReader)
