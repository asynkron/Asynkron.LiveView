#!/bin/bash

# run_with_mcp.sh - Run both the MCP server and LiveView server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Configuration
MARKDOWN_DIR=${MARKDOWN_DIR:-markdown}
LIVEVIEW_PORT=${LIVEVIEW_PORT:-8080}
MCP_PORT=${MCP_PORT:-8081}

echo "🚀 Asynkron.LiveView with MCP Server"
echo "===================================="
echo ""

print_info "Configuration:"
echo "  Markdown Directory: $MARKDOWN_DIR"
echo "  LiveView Port: $LIVEVIEW_PORT"
echo "  MCP Server: Available via stdio"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    print_error "Python is not installed or not in PATH"
    exit 1
fi

PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
fi

print_info "Using Python command: $PYTHON_CMD"

# Check dependencies
print_info "Checking dependencies..."
if ! $PYTHON_CMD -c "import aiohttp, watchdog, mcp" 2>/dev/null; then
    print_warning "Installing missing dependencies..."
    $PYTHON_CMD -m pip install -r requirements.txt
    if [ $? -eq 0 ]; then
        print_success "Dependencies installed successfully"
    else
        print_error "Failed to install dependencies"
        exit 1
    fi
else
    print_success "All dependencies are available"
fi

# Create markdown directory if it doesn't exist
if [ ! -d "$MARKDOWN_DIR" ]; then
    print_info "Creating markdown directory..."
    mkdir -p "$MARKDOWN_DIR"
    print_success "Created markdown directory: $MARKDOWN_DIR"
fi

# Test MCP server functionality
print_info "Testing MCP server functionality..."
if $PYTHON_CMD test_mcp.py; then
    print_success "MCP server test passed"
else
    print_warning "MCP server test had issues, but continuing..."
fi

echo ""
print_info "🎯 Server Information"
echo "================================"
echo ""
echo "📍 LiveView Server:"
echo "   URL: http://localhost:$LIVEVIEW_PORT"
echo "   Purpose: Web interface for viewing markdown files"
echo ""
echo "🤖 MCP Server:"
echo "   Type: Model Context Protocol (stdio)"
echo "   Purpose: Allows AI assistants to create/manage markdown files"
echo "   Config: mcp_config.json"
echo ""
echo "🔧 AI Assistant Setup:"
echo "   1. Configure your AI assistant to use MCP"
echo "   2. Point it to this directory's mcp_server.py"
echo "   3. Use the provided tools to create markdown files"
echo ""
echo "📖 Available MCP Tools:"
echo "   - create_markdown_file: Create new markdown files"
echo "   - list_markdown_files: List existing files"
echo "   - read_markdown_file: Read file contents"  
echo "   - update_markdown_file: Append/replace content"
echo "   - delete_markdown_file: Remove files"
echo ""

# Start the LiveView server
print_info "Starting LiveView server on port $LIVEVIEW_PORT..."
print_info "The MCP server runs on-demand when called by AI assistants"
print_info "Press Ctrl+C to stop the server"
echo ""

exec $PYTHON_CMD server.py --port $LIVEVIEW_PORT --dir $MARKDOWN_DIR