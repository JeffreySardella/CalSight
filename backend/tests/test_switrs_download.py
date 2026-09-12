"""SWITRS download must fetch the direct Zenodo file link, not files-archive.

2026-09-12: Zenodo started refusing `files-archive` for records over 300 MB
(HTTP 400 "Archive download is only available for records with total file
size up to 300000000 bytes"), so the SWITRS 2001 reload could not even start.
The record is one 1.3 GB switrs.sqlite.gz; fetch it directly and gunzip it.
"""

import gzip
from contextlib import contextmanager

import etl.switrs_api as switrs_api


class _FakeResponse:
    def __init__(self, payload: bytes):
        self._payload = payload

    def raise_for_status(self):
        return None

    def iter_bytes(self):
        yield self._payload[:10]
        yield self._payload[10:]


def test_downloads_direct_file_link_and_gunzips(tmp_path, monkeypatch):
    seen = {}

    @contextmanager
    def fake_stream(method, url, **kwargs):
        seen["url"] = url
        yield _FakeResponse(gzip.compress(b"SQLite format 3\x00fake-db"))

    monkeypatch.setattr(switrs_api.httpx, "stream", fake_stream)

    sqlite_path = switrs_api.download_switrs_archive(str(tmp_path))

    assert seen["url"].endswith("/files/switrs.sqlite.gz/content")
    assert "files-archive" not in seen["url"]
    assert sqlite_path.endswith("switrs.sqlite")
    with open(sqlite_path, "rb") as f:
        assert f.read() == b"SQLite format 3\x00fake-db"
