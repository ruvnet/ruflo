import re
from typing import Tuple
from uuid import UUID

from chromadb.db.base import SqlDB
from chromadb.segment import SegmentManager, VectorReader

topic_regex = r"persistent:\/\/(?P<tenant>.+)\/(?P<namespace>.+)\/(?P<topic>.+)"


def parse_topic_name(topic_name: str) -> Tuple[str, str, str]:
    """Parse the topic name into the tenant, namespace and topic name"""
    match = re.match(topic_regex, topic_name)
    if not match:
        raise ValueError(f"Invalid topic name: {topic_name}")
    return match.group("tenant"), match.group("namespace"), match.group("topic")


def create_topic_name(tenant: str, namespace: str, collection_id: UUID) -> str:
    return f"persistent://{tenant}/{namespace}/{str(collection_id)}"


def trigger_vector_segments_max_seq_id_migration(
    db: SqlDB, segment_manager: SegmentManager
) -> None:
    """
    Trigger the migration of vector segments' max_seq_id from the pickled metadata file to SQLite.

    Vector segments migrate this field automatically on init—so this should be used when we know segments are likely unmigrated and unloaded.

    This is a no-op if all vector segments have already migrated their max_seq_id.
    """
    with db.tx() as cur:
        cur.execute(
            """
            SELECT collection
            FROM "segments"
            WHERE "id" NOT IN (SELECT "segment_id" FROM "max_seq_id") AND
                  "type" = 'urn:chroma:segment/vector/hnsw-local-persisted'
        """
        )
        collection_ids_with_unmigrated_segments = [row[0] for row in cur.fetchall()]

    if len(collection_ids_with_unmigrated_segments) == 0:
        return

    for collection_id in collection_ids_with_unmigrated_segments:
        # Loading the segment triggers the migration on init
        segment_manager.get_segment(UUID(collection_id), VectorReader)
