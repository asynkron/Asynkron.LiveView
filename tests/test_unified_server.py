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
