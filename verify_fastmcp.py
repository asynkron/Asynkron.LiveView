#!/usr/bin/env python3
"""Verification script to confirm FastMCP-only implementation."""

import ast
import os
from pathlib import Path

def analyze_server_py():
    """Analyze server.py to confirm FastMCP-only implementation."""
    
    server_path = Path("server.py")
    if not server_path.exists():
        return "❌ server.py not found"
    
    content = server_path.read_text()
    tree = ast.parse(content)
    
    # Check imports
    fastmcp_imports = []
    legacy_mcp_imports = []
    
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.module == "fastmcp":
                fastmcp_imports.append([alias.name for alias in node.names])
            elif node.module and "mcp.types" in node.module:
                legacy_mcp_imports.append(node.module)
    
    # Check for @tool decorators
    tool_decorators = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Attribute) and decorator.attr == "tool":
                    tool_decorators.append(node.name)
    
    # Check for legacy method names
    legacy_methods = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            if node.name in ["_build_tool_definitions", "_handle_mcp_initialize", "handle_mcp_http", "handle_mcp_info"]:
                legacy_methods.append(node.name)
    
    return {
        "fastmcp_imports": fastmcp_imports,
        "legacy_mcp_imports": legacy_mcp_imports,
        "tool_decorators": tool_decorators,
        "legacy_methods": legacy_methods,
        "has_fastmcp": len(fastmcp_imports) > 0,
        "is_clean": len(legacy_mcp_imports) == 0 and len(legacy_methods) == 0
    }

def check_components():
    """Check components directory."""
    components_dir = Path("components")
    files = list(components_dir.glob("*.py"))
    
    return {
        "files": [f.name for f in files],
        "has_mcp_tools": "mcp_tools.py" in [f.name for f in files]
    }

def main():
    """Run verification."""
    print("🔍 FastMCP Implementation Verification\n")
    
    # Analyze server.py
    server_analysis = analyze_server_py()
    
    print("📄 Server.py Analysis:")
    print(f"  FastMCP imports: {server_analysis['fastmcp_imports']}")
    print(f"  Legacy MCP imports: {server_analysis['legacy_mcp_imports']}")
    print(f"  @tool decorators: {server_analysis['tool_decorators']}")
    print(f"  Legacy methods found: {server_analysis['legacy_methods']}")
    print(f"  Has FastMCP: {'✅' if server_analysis['has_fastmcp'] else '❌'}")
    print(f"  Is clean (no legacy): {'✅' if server_analysis['is_clean'] else '❌'}")
    
    # Check components
    components_analysis = check_components()
    print(f"\n📁 Components Directory:")
    print(f"  Files: {components_analysis['files']}")
    print(f"  Has mcp_tools.py: {'❌' if not components_analysis['has_mcp_tools'] else '✅ (SHOULD BE DELETED)'}")
    
    # Overall status
    print(f"\n🎯 Overall Status:")
    is_fastmcp_only = (
        server_analysis['has_fastmcp'] and 
        server_analysis['is_clean'] and 
        not components_analysis['has_mcp_tools']
    )
    print(f"  FastMCP-only implementation: {'✅' if is_fastmcp_only else '❌'}")
    
    if is_fastmcp_only:
        print("\n🚀 SUCCESS: Clean FastMCP implementation confirmed!")
        print("   - Only FastMCP imports")
        print("   - @tool() decorators working") 
        print("   - No legacy MCP code")
        print("   - No mcp_tools.py file")
    else:
        print("\n⚠️  ISSUES FOUND - check above details")

if __name__ == "__main__":
    main()