"""Regression tests for LocalMediaServer."""

import os
import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import MagicMock

from el_sbobinator.core.media_server import LocalMediaServer


def _fake_server():
    srv = MagicMock()
    srv.server_address = ("127.0.0.1", 0)
    return srv


class EvictOldestTests(unittest.TestCase):
    def setUp(self):
        LocalMediaServer._servers.clear()

    def tearDown(self):
        LocalMediaServer._servers.clear()

    def test_no_error_at_capacity(self):
        """_evict_oldest_if_needed must not raise TypeError when _servers is a plain dict."""
        for i in range(LocalMediaServer.MAX_ENTRIES):
            LocalMediaServer._servers[f"/fake/path_{i}.mp3"] = (
                _fake_server(),
                9000 + i,
                "tok",
            )

        try:
            LocalMediaServer._evict_oldest_if_needed()
        except TypeError as exc:
            self.fail(f"_evict_oldest_if_needed raised TypeError: {exc}")

    def test_removes_first_inserted(self):
        """The oldest (first-inserted) entry is the one evicted."""
        paths = [f"/fake/path_{i}.mp3" for i in range(LocalMediaServer.MAX_ENTRIES)]
        for i, p in enumerate(paths):
            LocalMediaServer._servers[p] = (_fake_server(), 9000 + i, "tok")

        LocalMediaServer._evict_oldest_if_needed()

        self.assertNotIn(paths[0], LocalMediaServer._servers)
        for p in paths[1:]:
            self.assertIn(p, LocalMediaServer._servers)

    def test_noop_below_capacity(self):
        """No eviction occurs when below MAX_ENTRIES."""
        for i in range(LocalMediaServer.MAX_ENTRIES - 1):
            LocalMediaServer._servers[f"/fake/path_{i}.mp3"] = (
                _fake_server(),
                9000 + i,
                "tok",
            )

        LocalMediaServer._evict_oldest_if_needed()

        self.assertEqual(
            len(LocalMediaServer._servers), LocalMediaServer.MAX_ENTRIES - 1
        )

    def test_evict_calls_shutdown(self):
        """Evicted server's shutdown and server_close are called."""
        oldest = _fake_server()
        LocalMediaServer._servers["/fake/oldest.mp3"] = (oldest, 9000, "tok")
        for i in range(1, LocalMediaServer.MAX_ENTRIES):
            LocalMediaServer._servers[f"/fake/path_{i}.mp3"] = (
                _fake_server(),
                9000 + i,
                "tok",
            )

        LocalMediaServer._evict_oldest_if_needed()

        threading.Event().wait(0.1)
        oldest.shutdown.assert_called_once()
        oldest.server_close.assert_called_once()

    def test_cache_hit_survives_eviction(self):
        """A cache hit moves an entry to MRU so the next-oldest item is evicted."""
        paths = [f"/fake/path_{i}.mp3" for i in range(LocalMediaServer.MAX_ENTRIES - 1)]
        for i, path in enumerate(paths):
            LocalMediaServer._servers[path] = (_fake_server(), 9000 + i, "tok")

        entry = LocalMediaServer._servers.pop(paths[0])
        LocalMediaServer._servers[paths[0]] = entry

        LocalMediaServer._servers["/fake/new.mp3"] = (_fake_server(), 9099, "tok")
        LocalMediaServer._evict_oldest_if_needed()

        self.assertIn(paths[0], LocalMediaServer._servers)
        self.assertNotIn(paths[1], LocalMediaServer._servers)


class RangeRequestTests(unittest.TestCase):
    def setUp(self):
        LocalMediaServer.shutdown_all()
        LocalMediaServer._servers.clear()
        self._tmp_path = None

    def tearDown(self):
        LocalMediaServer.shutdown_all()
        LocalMediaServer._servers.clear()
        if self._tmp_path and os.path.exists(self._tmp_path):
            os.unlink(self._tmp_path)

    def _make_url(self, data: bytes) -> str:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
        try:
            tmp.write(data)
        finally:
            tmp.close()
        self._tmp_path = tmp.name
        return LocalMediaServer.stream_url_for_file(self._tmp_path)

    def test_url_contains_secret_token(self):
        """Returned URL must embed a hex token in the path."""
        url = self._make_url(b"hello")
        path = url.split("?", 1)[0]
        self.assertRegex(path, r"http://127\.0\.0\.1:\d+/stream-[0-9a-f]{32}/media")

    def test_wrong_token_returns_404(self):
        """A request with a different token in the path must return 404."""
        url = self._make_url(b"hello")
        wrong_url = re.sub(
            r"/stream-[0-9a-f]+/", "/stream-deadbeef0000000000000000deadbeef/", url
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(wrong_url, timeout=5)
        self.assertEqual(ctx.exception.code, 404)

    def test_root_path_returns_404(self):
        """A bare request to / must return 404."""
        url = self._make_url(b"hello")
        m = re.match(r"http://127\.0\.0\.1:\d+", url)
        self.assertIsNotNone(m, f"URL did not match expected pattern: {url!r}")
        assert m is not None
        base = m.group(0)
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(f"{base}/", timeout=5)
        self.assertEqual(ctx.exception.code, 404)

    def test_cache_hit_returns_same_token(self):
        """A second call for the same file must reuse the same token (cache hit)."""
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
        try:
            tmp.write(b"data")
        finally:
            tmp.close()
        self._tmp_path = tmp.name
        url1 = LocalMediaServer.stream_url_for_file(self._tmp_path)
        url2 = LocalMediaServer.stream_url_for_file(self._tmp_path)
        m1 = re.search(r"/stream-([0-9a-f]+)/", url1)
        m2 = re.search(r"/stream-([0-9a-f]+)/", url2)
        self.assertIsNotNone(m1, f"url1 missing stream token: {url1!r}")
        self.assertIsNotNone(m2, f"url2 missing stream token: {url2!r}")
        assert m1 is not None
        assert m2 is not None
        token1 = m1.group(1)
        token2 = m2.group(1)
        self.assertEqual(token1, token2)

    def test_unsatisfiable_range_returns_416(self):
        """bytes=50-60 on a 10-byte file must return 416."""
        url = self._make_url(b"0123456789")
        req = urllib.request.Request(url, headers={"Range": "bytes=50-60"})

        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)

        self.assertEqual(ctx.exception.code, 416)
        self.assertEqual(ctx.exception.headers.get("Content-Range"), "bytes */10")

    def test_suffix_range_returns_last_bytes(self):
        """bytes=-4 must return the final four bytes as partial content."""
        url = self._make_url(b"0123456789")
        req = urllib.request.Request(url, headers={"Range": "bytes=-4"})

        with urllib.request.urlopen(req, timeout=5) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.headers.get("Content-Range"), "bytes 6-9/10")
            self.assertEqual(response.read(), b"6789")


if __name__ == "__main__":
    unittest.main()
