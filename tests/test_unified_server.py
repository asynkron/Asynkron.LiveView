"""Unit tests for the unified LiveView + MCP server."""

from pathlib import Path
from typing import Optional
import sys

# Ensure the project root is importable when tests run from the repository root.
sys.path.append(str(Path(__file__).resolve().parents[1]))

import pytest
from aiohttp.test_utils import TestClient, TestServer

from unified_server import UnifiedMarkdownServer


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
        if line.lower().startswith("file id:"):
            return line.split(":", 1)[1].strip()
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

    client = await _create_test_client(server)
    try:
        # Ask the MCP bridge for the available tools.
        tools_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {},
        }
        response = await client.post("/mcp", json=tools_request)
        assert response.status == 200

        payload = await response.json()
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
        response = await client.post("/mcp", json=show_request)
        assert response.status == 200

        payload = await response.json()
        text_block = payload["result"]["content"][0]["text"]
        file_id = _extract_file_id(text_block)
        assert file_id is not None

        created_path = tmp_path / file_id
        assert created_path.exists()
        assert "Hello from tests" in created_path.read_text()
    finally:
        await client.close()


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

