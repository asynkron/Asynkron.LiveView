#!/bin/bash

# run_unified.sh - Run the unified server combining LiveView and MCP functionality

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
PORT=${PORT:-8080}

echo "🚀 Unified Markdown Live View Server"
echo "====================================="
echo ""

print_info "Configuration:"
echo "  Markdown Directory: $MARKDOWN_DIR"
echo "  Server Port: $PORT"
echo ""

# Detect Python command
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    print_error "Python not found. Please install Python 3.7+"
    exit 1
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
    
    # Create a welcome file
    cat > "$MARKDOWN_DIR/01-welcome.md" << 'EOF'
# Welcome to Unified Markdown Live View! 🎉

This is your unified server that combines both LiveView and MCP functionality in a single application!

## Getting Started

1. 📝 **Create new markdown files** in this directory
2. 🔄 **Watch them appear automatically** in your browser
3. ✨ **Edit files** and see live updates without refreshing
4. 🤖 **Use AI assistants** with MCP integration to create/manage files

## Unified Server Features

### LiveView Server
- ⏰ **Chronological ordering** by file creation time
- 🔄 **Live updates** via WebSocket
- 🎨 **Full markdown support** with syntax highlighting
- 📊 **Mermaid diagrams** support

### MCP Server Integration
- 🤖 **HTTP MCP endpoint** at `/mcp` for AI assistants
- 📝 **File creation/management** tools
- 🔄 **Real-time integration** with LiveView
- 📡 **JSON-RPC protocol** support

## MCP Tools Available

- `create_markdown_file`: Create new markdown files
- `list_markdown_files`: List existing files
- `read_markdown_file`: Read file contents
- `update_markdown_file`: Append/replace content
- `delete_markdown_file`: Remove files

## Example MCP Usage

```bash
# Test the MCP HTTP endpoint
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "create_markdown_file",
      "arguments": {
        "filename": "ai-created",
        "content": "# AI Created File\n\nThis file was created via MCP!"
      }
    }
  }'
```

## Architecture Diagram

```mermaid
graph TD
    A[AI Assistant] --> B[MCP HTTP Endpoint]
    B --> C[Unified Server]
    C --> D[File System]
    C --> E[File Watcher]
    E --> F[WebSocket]
    F --> G[Browser]
    
    style A fill:#e1f5fe
    style C fill:#fff3e0
    style G fill:#c8e6c9
```

## Benefits of Unified Architecture

- **Single Process**: No need to manage separate servers
- **Shared Resources**: Common file watching and directory management
- **Simplified Deployment**: One server to start and stop
- **Better Integration**: Direct communication between components
- **Reduced Complexity**: Fewer moving parts to manage

Happy writing! 📚
EOF
    print_success "Created markdown directory with welcome file"
else
    print_success "Markdown directory already exists"
fi

echo ""
print_info "🎯 Unified Server Information"
echo "================================="
echo ""
echo "📍 LiveView Interface:"
echo "   URL: http://localhost:$PORT"
echo "   Purpose: Web interface for viewing markdown files"
echo ""
echo "🤖 MCP Integration:"
echo "   HTTP Endpoint: POST http://localhost:$PORT/mcp"
echo "   Protocol: JSON-RPC 2.0 over HTTP"
echo "   Purpose: AI assistant integration for file management"
echo ""
echo "🔧 Features:"
echo "   - Real-time markdown viewing"
echo "   - File system monitoring"
echo "   - AI assistant integration"
echo "   - WebSocket live updates"
echo "   - Combined in single process"
echo ""

# Start the unified server
print_info "Starting unified server on port $PORT..."
print_info "Press Ctrl+C to stop the server"
echo ""

exec $PYTHON_CMD unified_server.py --port $PORT --dir $MARKDOWN_DIR