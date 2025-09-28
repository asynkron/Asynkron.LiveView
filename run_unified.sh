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
VENV_NAME="venv"
REQUIREMENTS_FILE="requirements.txt"

echo "🚀 Unified Markdown Live View Server"
echo "====================================="
echo ""

print_info "Configuration:"
echo "  Markdown Directory: $MARKDOWN_DIR"
echo "  Server Port: $PORT"
echo ""

# Detect Python command
detect_python() {
    print_info "Detecting Python installation..."
    
    # Try different Python commands
    for cmd in python3 python python3.12 python3.11 python3.10 python3.9; do
        if command -v "$cmd" >/dev/null 2>&1; then
            # Check if it's Python 3.7+
            version_check=$("$cmd" -c "import sys; print('.'.join(map(str, sys.version_info[:2])))" 2>/dev/null)
            if [ $? -eq 0 ]; then
                major=$(echo "$version_check" | cut -d. -f1)
                minor=$(echo "$version_check" | cut -d. -f2)
                if [ "$major" -eq 3 ] && [ "$minor" -ge 7 ]; then
                    PYTHON_CMD="$cmd"
                    PIP_CMD="$cmd -m pip"
                    print_success "Found Python: $cmd (Python $version_check)"
                    return 0
                fi
            fi
        fi
    done
    
    print_error "Python 3.7+ not found. Please install Python 3.7 or later."
    exit 1
}

# Setup virtual environment
setup_venv() {
    print_info "Setting up virtual environment..."
    
    if [ ! -d "$VENV_NAME" ]; then
        print_info "Creating virtual environment..."
        if ! "$PYTHON_CMD" -m venv "$VENV_NAME"; then
            print_error "Failed to create virtual environment"
            print_info "Trying without virtual environment..."
            return 1
        fi
        print_success "Virtual environment created"
    else
        print_success "Virtual environment already exists"
    fi
    
    # Activate virtual environment
    source "$VENV_NAME/bin/activate" || {
        print_error "Failed to activate virtual environment"
        return 1
    }
    
    print_success "Virtual environment activated"
    return 0
}

# Install dependencies with fallback strategies
install_dependencies() {
    print_info "Checking dependencies..."
    
    # First check if all dependencies are already available
    if "$PYTHON_CMD" -c "import aiohttp, watchdog, mcp" 2>/dev/null; then
        print_success "All dependencies are available"
        return 0
    fi
    
    print_info "Installing Python dependencies..."
    
    # Upgrade pip first
    print_info "Upgrading pip..."
    "$PYTHON_CMD" -m pip install --upgrade pip || print_warning "Pip upgrade failed, continuing anyway..."
    
    # Strategy 1: Try normal pip install
    if "$PYTHON_CMD" -m pip install -r "$REQUIREMENTS_FILE"; then
        print_success "Dependencies installed successfully"
        return 0
    fi
    
    print_warning "Normal installation failed, trying alternative methods..."
    
    # Strategy 2: Try user installation
    print_info "Trying user installation..."
    if "$PYTHON_CMD" -m pip install --user -r "$REQUIREMENTS_FILE"; then
        print_success "Dependencies installed in user directory"
        return 0
    fi
    
    # Strategy 3: Try with --break-system-packages (for externally managed environments)
    print_info "Trying with --break-system-packages..."
    if "$PYTHON_CMD" -m pip install --break-system-packages -r "$REQUIREMENTS_FILE"; then
        print_success "Dependencies installed with system packages override"
        return 0
    fi
    
    # Strategy 4: Try installing individual packages
    print_info "Trying individual package installation..."
    for package in "aiohttp>=3.9.0" "watchdog>=3.0.0" "mcp>=1.0.0"; do
        if "$PYTHON_CMD" -m pip install --user "$package" || \
           "$PYTHON_CMD" -m pip install --break-system-packages "$package"; then
            print_info "Installed $package"
        else
            print_warning "Failed to install $package"
        fi
    done
    
    # Final verification
    if "$PYTHON_CMD" -c "import aiohttp, watchdog, mcp" 2>/dev/null; then
        print_success "All dependencies are now available"
        return 0
    else
        print_error "Failed to install all required dependencies"
        print_info "Manual installation required:"
        print_info "  python3 -m pip install --user aiohttp watchdog mcp"
        print_info "  OR"
        print_info "  python3 -m pip install --break-system-packages aiohttp watchdog mcp"
        return 1
    fi
}

# Detect Python and setup environment
detect_python

# Try to setup virtual environment, but continue without it if it fails
if setup_venv; then
    print_info "Using virtual environment"
else
    print_warning "Continuing without virtual environment"
fi

# Install dependencies
if ! install_dependencies; then
    print_error "Dependency installation failed"
    exit 1
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