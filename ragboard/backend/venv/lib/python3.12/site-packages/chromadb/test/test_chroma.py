import unittest
import os
from unittest.mock import patch, Mock
import pytest
import chromadb
import chromadb.config
from chromadb.db.system import SysDB
from chromadb.ingest import Consumer, Producer


class GetDBTest(unittest.TestCase):
    @patch("chromadb.db.impl.sqlite.SqliteDB", autospec=True)
    def test_default_db(self, mock: Mock) -> None:
        system = chromadb.config.System(
            chromadb.config.Settings(persist_directory="./foo")
        )
        system.instance(SysDB)
        assert mock.called

    @patch("chromadb.db.impl.sqlite.SqliteDB", autospec=True)
    def test_sqlite_sysdb(self, mock: Mock) -> None:
        system = chromadb.config.System(
            chromadb.config.Settings(
                chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
                persist_directory="./foo",
            )
        )
        system.instance(SysDB)
        assert mock.called

    @patch("chromadb.db.impl.sqlite.SqliteDB", autospec=True)
    def test_sqlite_queue(self, mock: Mock) -> None:
        system = chromadb.config.System(
            chromadb.config.Settings(
                chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
                chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
                chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
                persist_directory="./foo",
            )
        )
        system.instance(Producer)
        system.instance(Consumer)
        assert mock.called


class GetAPITest(unittest.TestCase):
    @patch("chromadb.api.segment.SegmentAPI", autospec=True)
    @patch.dict(
        os.environ, {"CHROMA_API_IMPL": "chromadb.api.segment.SegmentAPI"}, clear=True
    )
    def test_local(self, mock_api: Mock) -> None:
        client = chromadb.Client(chromadb.config.Settings(persist_directory="./foo"))
        assert mock_api.called
        client.clear_system_cache()

    @patch("chromadb.db.impl.sqlite.SqliteDB", autospec=True)
    @patch.dict(
        os.environ, {"CHROMA_API_IMPL": "chromadb.api.segment.SegmentAPI"}, clear=True
    )
    def test_local_db(self, mock_db: Mock) -> None:
        client = chromadb.Client(chromadb.config.Settings(persist_directory="./foo"))
        assert mock_db.called
        client.clear_system_cache()

    @patch("chromadb.api.fastapi.FastAPI", autospec=True)
    @patch.dict(os.environ, {}, clear=True)
    def test_fastapi(self, mock: Mock) -> None:
        client = chromadb.Client(
            chromadb.config.Settings(
                chroma_api_impl="chromadb.api.fastapi.FastAPI",
                persist_directory="./foo",
                chroma_server_host="foo",
                chroma_server_http_port=80,
            )
        )
        assert mock.called
        client.clear_system_cache()

    @patch("chromadb.api.fastapi.FastAPI", autospec=True)
    @patch.dict(os.environ, {}, clear=True)
    def test_settings_pass_to_fastapi(self, mock: Mock) -> None:
        settings = chromadb.config.Settings(
            chroma_api_impl="chromadb.api.fastapi.FastAPI",
            chroma_server_host="foo",
            chroma_server_http_port=80,
            chroma_server_headers={"foo": "bar"},
        )
        client = chromadb.Client(settings)

        # Check that the mock was called
        assert mock.called

        # Retrieve the arguments with which the mock was called
        # `call_args` returns a tuple, where the first element is a tuple of positional arguments
        # and the second element is a dictionary of keyword arguments. We assume here that
        # the settings object is passed as a positional argument.
        args, kwargs = mock.call_args
        passed_settings = args[0] if args else None

        # Check if the settings passed to the mock match the settings we used
        # raise Exception(passed_settings.settings)
        assert passed_settings.settings == settings
        client.clear_system_cache()


def test_legacy_values() -> None:
    with pytest.raises(ValueError):
        client = chromadb.Client(
            chromadb.config.Settings(
                chroma_api_impl="chromadb.api.local.LocalAPI",
                persist_directory="./foo",
                chroma_server_host="foo",
                chroma_server_http_port=80,
            )
        )
        client.clear_system_cache()
