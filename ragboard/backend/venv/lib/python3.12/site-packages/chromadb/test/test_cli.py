import multiprocessing
import multiprocessing.context
import sys
import time
from multiprocessing.synchronize import Event

import chromadb
from chromadb.api.client import Client
from chromadb.api.models.Collection import Collection
from chromadb.cli import cli
from chromadb.cli.cli import build_cli_args
from chromadb.config import Settings, System
from chromadb.db.base import get_sql
from chromadb.db.impl.sqlite import SqliteDB
from pypika import Table
import numpy as np

from chromadb.test.property import invariants


def wait_for_server(
        host: str, port: int,
    max_retries: int = 5, initial_delay: float = 1.0
) -> bool:
    """Wait for server to be ready using exponential backoff.
    Args:
        client: ChromaDB client instance
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay in seconds before first retry
    Returns:
        bool: True if server is ready, False if max retries exceeded
    """
    delay = initial_delay
    for attempt in range(max_retries):
        try:
            client = chromadb.HttpClient(host=host, port=port)
            heartbeat = client.heartbeat()
            if heartbeat > 0:
                return True
        except Exception:
            print("Heartbeat failed, trying again...")
            pass

        if attempt < max_retries - 1:
            time.sleep(delay)
            delay *= 2

    return False

def start_app(args: list[str]) -> None:
    sys.argv = args
    cli.app()

def test_app() -> None:
    kwargs = {"path": "chroma_test_data", "port": 8001}
    args = ["chroma", "run"]
    args.extend(build_cli_args(**kwargs))
    print(args)
    server_process = multiprocessing.Process(target=start_app, args=(args,))
    server_process.start()
    time.sleep(5)

    assert wait_for_server(host="localhost", port=8001), "Server failed to start within maximum retry attempts"

    server_process.terminate()
    server_process.join()


def test_vacuum(sqlite_persistent: System) -> None:
    system = sqlite_persistent
    sqlite = system.instance(SqliteDB)

    # This is True because it's a fresh system, so let's set it to False to test that the vacuum command enables it
    config = sqlite.config
    config.set_parameter("automatically_purge", False)
    sqlite.set_config(config)

    # Add some data
    client = Client.from_system(system)
    collection1 = client.create_collection("collection1")
    collection2 = client.create_collection("collection2")

    def add_records(collection: Collection, num: int) -> None:
        ids = [str(i) for i in range(num)]
        embeddings = np.random.rand(num, 2)
        collection.add(ids=ids, embeddings=embeddings)

    add_records(collection1, 100)
    add_records(collection2, 2_000)

    # Maintenance log should be empty
    with sqlite.tx() as cur:
        t = Table("maintenance_log")
        q = sqlite.querybuilder().from_(t).select("*")
        sql, params = get_sql(q)
        cur.execute(sql, params)
        assert cur.fetchall() == []

    sys.argv = ["chroma", "vacuum", "--path", system.settings.persist_directory, "--force"]
    cli.app()

    # Maintenance log should have a vacuum entry
    with sqlite.tx() as cur:
        t = Table("maintenance_log")
        q = sqlite.querybuilder().from_(t).select("*")
        sql, params = get_sql(q)
        cur.execute(sql, params)
        rows = cur.fetchall()
        assert len(rows) == 1
        assert rows[0][2] == "vacuum"

    # Automatic pruning should have been enabled
    if hasattr(sqlite, "config"):
        del (
            sqlite.config
        )  # the CLI will end up starting a new instance of sqlite, so we need to force-refresh the cached config here
    assert sqlite.config.get_parameter("automatically_purge").value

    # Log should be clean
    invariants.log_size_below_max(system, [collection1, collection2], True)


def simulate_transactional_write(
    settings: Settings, ready_event: Event, shutdown_event: Event
) -> None:
    system = System(settings=settings)
    system.start()
    sqlite = system.instance(SqliteDB)

    with sqlite.tx() as cur:
        cur.execute("INSERT INTO tenants DEFAULT VALUES")
        ready_event.set()
        shutdown_event.wait()

    system.stop()


def test_vacuum_errors_if_locked(sqlite_persistent: System, capfd) -> None:
    """Vacuum command should fail with details if there is a long-lived lock on the database."""
    ctx = multiprocessing.get_context("spawn")
    ready_event = ctx.Event()
    shutdown_event = ctx.Event()
    process = ctx.Process(
        target=simulate_transactional_write,
        args=(sqlite_persistent.settings, ready_event, shutdown_event),
    )
    process.start()
    ready_event.wait()

    try:
        sys.argv = ["chroma", "vacuum", "--path", sqlite_persistent.settings.persist_directory, "--force", "--timeout", "10"]
        cli.app()
        captured = capfd.readouterr()
        assert "Failed to vacuum Chroma" in captured.err.strip()
    finally:
        shutdown_event.set()
        process.join()
