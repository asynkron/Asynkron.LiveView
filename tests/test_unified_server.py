"""Unit tests for the unified LiveView + MCP server."""

from pathlib import Path
from typing import Optional
import sys
import json

# Ensure the project root is importable when tests run from the repository root.
sys.path.append(str(Path(__file__).resolve().parents[1]))

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer

from server import UnifiedMarkdownServer


async def _create_test_client(server: UnifiedMarkdownServer) -> TestClient:
    """Spin up an in-memory aiohttp server and client for testing."""
    app = server.create_app()
    test_server = TestServer(app)
    client = TestClient(test_server)
    await client.start_server()
    return client


def _extract_file_id(response_text: str) -> Optional[str]:
    """Helper that pulls the generated File Id out of an MCP response."""
    for line in response_text.splitlines():
        lower_line = line.lower()
        marker = "file id:"
        if marker in lower_line:
            idx = lower_line.index(marker) + len(marker)
            remainder = line[idx:].strip()
            if not remainder:
                continue
            # Remove any trailing metadata such as titles wrapped in parentheses.
            candidate = remainder.split("(", 1)[0].strip()
            if candidate:
                return candidate
    return None


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
async def test_mcp_http_endpoints(tmp_path: Path) -> None:
    """Ensure the MCP-over-HTTP endpoint lists tools and creates content."""
    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))

    # Interact with the FastMCP Starlette app directly via httpx's ASGI transport.
    mcp_app = server.mcp_http_app
    lifespan = mcp_app.router.lifespan_context(mcp_app)
    async with lifespan:
        transport = httpx.ASGITransport(app=mcp_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as mcp_client:
            # Ask the MCP bridge for the available tools.
            tools_request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {},
            }
            response = await mcp_client.post(
                "/mcp",
                json=tools_request,
                headers={"accept": "application/json, text/event-stream"},
            )
            assert response.status_code == 200

            payload = response.json()
            tools = payload["result"]["tools"]
            assert any(tool["name"] == "show_content" for tool in tools)

            # Create a markdown snippet through MCP and ensure it lands on disk.
            show_request = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "show_content",
                    "arguments": {
                        "title": "Test Entry",
                        "content": "# Hello from tests!\n",
                    },
                },
            }
            response = await mcp_client.post(
                "/mcp",
                json=show_request,
                headers={"accept": "application/json, text/event-stream"},
            )
            assert response.status_code == 200

            payload = response.json()
            text_block = payload["result"]["content"][0]["text"]
            file_id = _extract_file_id(text_block)
            assert file_id is not None

            created_path = tmp_path / file_id
            assert created_path.exists()
            assert "Hello from tests" in created_path.read_text()


@pytest.mark.asyncio
async def test_api_content_includes_file_list(tmp_path: Path) -> None:
    """Verify that /api/content returns fileList with metadata."""
    # Create a test markdown file
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
    # Create a test markdown file
    test_file = tmp_path / "delete-me.md"
    test_file.write_text("# Delete Me\n\nThis file will be deleted.")
    
    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    try:
        # Verify the file exists
        assert test_file.exists()
        
        # Delete the file via API
        response = await client.post("/api/delete", json={"fileId": "delete-me.md"})
        assert response.status == 200

        payload = await response.json()
        assert payload["success"] is True
        assert "deleted" in payload["message"].lower()
        
        # Verify the file was actually deleted
        assert not test_file.exists()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_get_file_endpoint(tmp_path: Path) -> None:
    """Verify that /api/file retrieves individual file content."""
    # Create a test markdown file
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
        response = await client.get("/api/file?fileId=nonexistent.md")
        assert response.status == 404

        payload = await response.json()
        assert payload["success"] is False
        assert "not found" in payload["error"].lower()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_toggle_sticky_endpoint(tmp_path: Path) -> None:
    """Verify that /api/toggle-sticky toggles sticky status correctly."""
    # Create test markdown files
    file1 = tmp_path / "file1.md"
    file1.write_text("# File 1\n\nFirst file.")
    file2 = tmp_path / "file2.md"
    file2.write_text("# File 2\n\nSecond file.")
    
    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    try:
        # Initially, no files should be sticky
        response = await client.get("/api/content")
        payload = await response.json()
        assert all(not f["isSticky"] for f in payload["fileList"])
        
        # Toggle file2 to be sticky
        response = await client.post("/api/toggle-sticky", json={"fileId": "file2.md"})
        assert response.status == 200
        payload = await response.json()
        assert payload["success"] is True
        assert payload["isSticky"] is True
        
        # Verify file2 is now sticky and at the top
        response = await client.get("/api/content")
        payload = await response.json()
        file_list = payload["fileList"]
        assert file_list[0]["name"] == "file2.md"
        assert file_list[0]["isSticky"] is True
        assert file_list[1]["isSticky"] is False
        
        # Toggle file1 to be sticky (should replace file2 as sticky)
        response = await client.post("/api/toggle-sticky", json={"fileId": "file1.md"})
        assert response.status == 200
        payload = await response.json()
        assert payload["success"] is True
        assert payload["isSticky"] is True
        
        # Verify only file1 is now sticky and at the top
        response = await client.get("/api/content")
        payload = await response.json()
        file_list = payload["fileList"]
        assert file_list[0]["name"] == "file1.md"
        assert file_list[0]["isSticky"] is True
        assert file_list[1]["isSticky"] is False
        
        # Toggle file1 again to remove sticky status
        response = await client.post("/api/toggle-sticky", json={"fileId": "file1.md"})
        assert response.status == 200
        payload = await response.json()
        assert payload["success"] is True
        assert payload["isSticky"] is False
        
        # Verify no files are sticky
        response = await client.get("/api/content")
        payload = await response.json()
        assert all(not f["isSticky"] for f in payload["fileList"])
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_stream_chat_subscription(tmp_path: Path) -> None:
    """Verify that /mcp/stream/chat provides NDJSON streaming for chat messages."""
    server = UnifiedMarkdownServer(markdown_dir=str(tmp_path))
    client = await _create_test_client(server)
    try:
        # Start HTTP streaming subscription (no polling allowed).
        response = await client.post("/mcp/stream/chat")
        assert response.status == 200
        assert response.headers.get("Content-Type") == "application/x-ndjson"

        # Read the initial subscription confirmation line.
        line = await response.content.readline()
        assert line
        payload = json.loads(line.decode("utf-8"))
        assert payload["result"].startswith("🔔")

    finally:
        await response.release()
        await client.close()

