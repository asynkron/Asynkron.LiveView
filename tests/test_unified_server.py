import json
import sys
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

# Ensure imports resolve to the repository modules.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from server import UnifiedMarkdownServer  # noqa: E402


async def _create_test_client(server: UnifiedMarkdownServer) -> TestClient:
    """Spin up an in-memory aiohttp test client for the unified server."""

    app = server.create_app()
    test_server = TestServer(app)
    client = TestClient(test_server)
    await client.start_server()
    return client


@pytest.mark.asyncio
async def test_index_renders_selected_file(tmp_path: Path) -> None:
    """Ensure the HTML payload includes the initial state for the first file."""

    first = tmp_path / "first.md"
    first.write_text("# Hello\n\nPrimary file")
    (tmp_path / "second.md").write_text("# Second\n\nContent")

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)

    try:
        response = await client.get(f"/?path={tmp_path}")
        assert response.status == 200
        html = await response.text()

        marker = "window.__INITIAL_STATE__ = "
        start = html.find(marker)
        assert start != -1
        start += len(marker)
        end = html.find(";", start)
        assert end != -1
        payload = html[start:end].strip()
        state = json.loads(payload)

        assert state["selectedFile"] == "first.md"
        assert "Primary file" in state["content"]
        assert len(state["files"]) == 2
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_file_listing_and_fetch(tmp_path: Path) -> None:
    """Verify that the JSON endpoints expose the directory contents."""

    target = tmp_path / "docs"
    target.mkdir()
    file_path = target / "note.md"
    file_path.write_text("# Note\n\nHello from tests")

    server = UnifiedMarkdownServer(markdown_dir=str(target))
    client = await _create_test_client(server)

    try:
        listing = await client.get(f"/api/files?path={target}")
        assert listing.status == 200
        payload = await listing.json()
        assert payload["files"]
        assert payload["files"][0]["name"] == "note.md"

        file_response = await client.get(f"/api/file?path={target}&file=note.md")
        assert file_response.status == 200
        file_payload = await file_response.json()
        assert file_payload["content"].startswith("# Note")
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_delete_endpoint_removes_files(tmp_path: Path) -> None:
    """Deleting a file through the API removes it from disk."""

    file_path = tmp_path / "remove-me.md"
    file_path.write_text("# Delete\n")

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)

    try:
        response = await client.delete(f"/api/file?path={tmp_path}&file=remove-me.md")
        assert response.status == 200
        payload = await response.json()
        assert payload["success"] is True
        assert not file_path.exists()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_missing_file_returns_404(tmp_path: Path) -> None:
    """Missing files should yield a clear HTTP 404 response."""

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)

    try:
        response = await client.get(f"/api/file?path={tmp_path}&file=absent.md")
        assert response.status == 404
        payload = await response.json()
        assert payload["error"] == "File not found"
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_raw_download_endpoint(tmp_path: Path) -> None:
    """The raw endpoint should stream the markdown content without JSON."""

    file_path = tmp_path / "download.md"
    file_path.write_text("# Downloadable\n")

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)

    try:
        response = await client.get(f"/api/file/raw?path={tmp_path}&file=download.md")
        assert response.status == 200
        text = await response.text()
        assert text.startswith("# Downloadable")
    finally:
        await client.close()
