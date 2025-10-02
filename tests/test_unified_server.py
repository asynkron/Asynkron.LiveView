import json
import sys
from pathlib import Path

import pytest
from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

# Ensure the project root is importable when tests run from the repository root.
sys.path.append(str(Path(__file__).resolve().parents[1]))

from server import UnifiedMarkdownServer


async def _create_test_client(server: UnifiedMarkdownServer) -> TestClient:
    """Spin up an in-memory aiohttp server and client for testing."""

    app = server.create_app()
    test_server = TestServer(app)
    client = TestClient(test_server)
    await client.start_server()
    return client


@pytest.mark.asyncio
async def test_server_boots_and_serves_content(tmp_path: Path) -> None:
    """Verify that the HTTP portion of the server starts and returns JSON."""

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))

    client = await _create_test_client(server)
    try:
        response = await client.get("/api/content")
        assert response.status == 200

        payload = await response.json()
        # Expect the endpoint to return the watched directory and fallback content.
        assert payload["files"] >= 1
        assert Path(payload["directory"]) == tmp_path
        assert "Directory Not Found or Empty" in payload["content"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_api_content_includes_file_list(tmp_path: Path) -> None:
    """Verify that /api/content returns fileList with metadata."""

    test_file = tmp_path / "test.md"
    test_file.write_text("# Test Content\n\nThis is a test.")

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    try:
        response = await client.get("/api/content")
        assert response.status == 200

        payload = await response.json()
        assert "fileList" in payload
        assert isinstance(payload["fileList"], list)
        assert len(payload["fileList"]) == 1

        file_info = payload["fileList"][0]
        assert file_info["name"] == "test.md"
        assert file_info["fileId"] == "test.md"
        assert "path" in file_info
        assert "created" in file_info
        assert "updated" in file_info
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_delete_file_endpoint(tmp_path: Path) -> None:
    """Verify that /api/delete successfully deletes files."""

    test_file = tmp_path / "delete-me.md"
    test_file.write_text("# Delete Me\n\nThis file will be deleted.")

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    try:
        assert test_file.exists()

        response = await client.post("/api/delete", json={"fileId": "delete-me.md"})
        assert response.status == 200

        payload = await response.json()
        assert payload["success"] is True
        assert "deleted" in payload["message"].lower()
        assert not test_file.exists()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_get_file_endpoint(tmp_path: Path) -> None:
    """Verify that /api/file retrieves individual file content."""

    test_content = "# Individual File\n\nThis is a single file's content."
    test_file = tmp_path / "get-me.md"
    test_file.write_text(test_content)

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    try:
        response = await client.get("/api/file?fileId=get-me.md")
        assert response.status == 200

        payload = await response.json()
        assert payload["success"] is True
        assert payload["fileId"] == "get-me.md"
        assert payload["content"] == test_content
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_delete_nonexistent_file(tmp_path: Path) -> None:
    """Verify that deleting a nonexistent file returns an error."""

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    try:
        response = await client.post("/api/delete", json={"fileId": "nonexistent.md"})
        assert response.status == 404

        payload = await response.json()
        assert payload["success"] is False
        assert "not found" in payload["error"].lower()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_get_nonexistent_file(tmp_path: Path) -> None:
    """Verify that getting a nonexistent file returns an error."""

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    try:
        response = await client.get("/api/file?fileId=missing.md")
        assert response.status == 404

        payload = await response.json()
        assert payload["success"] is False
        assert "not found" in payload["error"].lower()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_toggle_sticky_behavior(tmp_path: Path) -> None:
    """Verify that sticky flags are tracked per file."""

    file1 = tmp_path / "file1.md"
    file2 = tmp_path / "file2.md"
    file1.write_text("file one")
    file2.write_text("file two")

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    try:
        response = await client.post("/api/toggle-sticky", json={"fileId": "file2.md"})
        assert response.status == 200
        payload = await response.json()
        assert payload["success"] is True
        assert payload["isSticky"] is True

        response = await client.get("/api/content")
        payload = await response.json()
        file_list = payload["fileList"]
        assert file_list[0]["name"] == "file2.md"
        assert file_list[0]["isSticky"] is True

        response = await client.post("/api/toggle-sticky", json={"fileId": "file1.md"})
        assert response.status == 200
        payload = await response.json()
        assert payload["success"] is True
        assert payload["isSticky"] is True

        response = await client.get("/api/content")
        payload = await response.json()
        file_list = payload["fileList"]
        assert file_list[0]["name"] == "file1.md"
        assert file_list[0]["isSticky"] is True
        assert file_list[1]["isSticky"] is False

        response = await client.post("/api/toggle-sticky", json={"fileId": "file1.md"})
        assert response.status == 200
        payload = await response.json()
        assert payload["success"] is True
        assert payload["isSticky"] is False

        response = await client.get("/api/content")
        payload = await response.json()
        assert all(not f["isSticky"] for f in payload["fileList"])
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_agent_feed_receives_chat(tmp_path: Path) -> None:
    """Ensure chat messages fan out to agent feed connections."""

    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    agent_ws = await client.ws_connect("/agent-feed")
    ui_ws = await client.ws_connect("/ws")

    try:
        await ui_ws.send_str(json.dumps({"type": "chat", "message": "hello"}))
        msg = await agent_ws.receive(timeout=1)
        assert msg.type == WSMsgType.TEXT
        payload = json.loads(msg.data)
        assert payload["type"] == "chat"
        assert payload["text"] == "hello"
    finally:
        await ui_ws.close()
        await agent_ws.close()
        await client.close()
