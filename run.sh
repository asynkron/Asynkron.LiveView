#!/usr/bin/env bash
set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
VENV_NAME="venv"
PYTHON_CMD=""
PIP_CMD=""
REQUIREMENTS_FILE="requirements.txt"
PORT=${PORT:-8080}
MARKDOWN_DIR=${MARKDOWN_DIR:-"markdown"}

# Print colored output
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

print_banner() {
    echo
    echo -e "${BLUE}🚀 Markdown Live View - Automated Setup${NC}"
    echo -e "${BLUE}==============================================${NC}"
    echo
}

# Detect Python command
detect_python() {
    print_info "Detecting Python installation..."
    
    # Try different Python commands
    for cmd in python3 python python3.12 python3.11 python3.10 python3.9; do
        if command -v "$cmd" >/dev/null 2>&1; then
            # Check if it's Python 3.7+
            if "$cmd" -c "import sys; exit(0 if sys.version_info >= (3, 7) else 1)" 2>/dev/null; then
                PYTHON_CMD="$cmd"
                print_success "Found Python: $cmd ($($cmd --version))"
                return 0
            fi
        fi
    done
    
    print_error "No suitable Python 3.7+ installation found!"
    print_error "Please install Python 3.7 or later:"
    print_error "  - Ubuntu/Debian: sudo apt install python3 python3-pip python3-venv"
    print_error "  - macOS: brew install python3"
    print_error "  - Or download from: https://python.org/downloads/"
    exit 1
}

# Check if we're in a virtual environment
in_venv() {
    [[ -n "$VIRTUAL_ENV" ]] || [[ -n "$CONDA_DEFAULT_ENV" ]]
}

# Create and activate virtual environment
setup_venv() {
    if in_venv; then
        print_success "Already in virtual environment: ${VIRTUAL_ENV:-$CONDA_DEFAULT_ENV}"
        return 0
    fi
    
    print_info "Setting up virtual environment..."
    
    # Create venv if it doesn't exist
    if [[ ! -d "$VENV_NAME" ]]; then
        print_info "Creating virtual environment..."
        if ! "$PYTHON_CMD" -m venv "$VENV_NAME"; then
            print_error "Failed to create virtual environment"
            print_error "Trying with --system-site-packages..."
            if ! "$PYTHON_CMD" -m venv --system-site-packages "$VENV_NAME"; then
                print_error "Virtual environment creation failed completely"
                return 1
            fi
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
    for package in aiohttp watchdog; do
        if "$PYTHON_CMD" -m pip install --user "$package" || \
           "$PYTHON_CMD" -m pip install --break-system-packages "$package"; then
            print_success "Installed $package"
        else
            print_error "Failed to install $package"
            return 1
        fi
    done
    
    print_success "All dependencies installed individually"
    return 0
}

# Check if dependencies are available
check_dependencies() {
    print_info "Checking dependencies..."
    
    if "$PYTHON_CMD" -c "import aiohttp, watchdog" 2>/dev/null; then
        print_success "All dependencies are available"
        return 0
    else
        print_warning "Some dependencies are missing"
        return 1
    fi
}

# Create markdown directory if it doesn't exist
setup_directories() {
    if [[ ! -d "$MARKDOWN_DIR" ]]; then
        print_info "Creating markdown directory..."
        mkdir -p "$MARKDOWN_DIR"
        
        # Create a welcome file
        cat > "$MARKDOWN_DIR/01-welcome.md" << 'EOF'
# Welcome to Markdown Live View! 🎉

This is your markdown directory. Any `.md` files you add here will be automatically detected and displayed in real-time!

## Getting Started

1. 📝 **Create new markdown files** in this directory
2. 🔄 **Watch them appear automatically** in your browser
3. ✨ **Edit files** and see live updates without refreshing

## Features

- ⏰ **Chronological ordering** by file creation time
- 🔄 **Live updates** via WebSocket
- 🎨 **Full markdown support** with syntax highlighting
- 📊 **Mermaid diagrams** (try adding a mermaid code block!)

## Example Mermaid Diagram

```mermaid
graph LR
    A[Create .md file] --> B[Auto-detected]
    B --> C[Rendered in browser]
    C --> D[Live updates!]
```

Happy writing! 📚
EOF
        print_success "Created markdown directory with welcome file"
    else
        print_success "Markdown directory already exists"
    fi
}

# Start the server
start_server() {
    print_info "Starting Markdown Live View server..."
    print_info "Server will be available at: http://localhost:$PORT"
    print_info "Watching directory: $MARKDOWN_DIR"
    print_info "Press Ctrl+C to stop the server"
    echo
    
    # Start the server using the Python script
    if [[ -f "start.py" ]]; then
        exec "$PYTHON_CMD" start.py --port "$PORT" --dir "$MARKDOWN_DIR"
    elif [[ -f "server.py" ]]; then
        exec "$PYTHON_CMD" server.py --port "$PORT" --dir "$MARKDOWN_DIR"
    else
        print_error "No server script found (start.py or server.py)"
        exit 1
    fi
}

# Cleanup function
cleanup() {
    if [[ -n "$CLEANUP_VENV" ]] && in_venv; then
        print_info "Deactivating virtual environment..."
        deactivate 2>/dev/null || true
    fi
}

# Main setup function
main() {
    print_banner
    
    # Change to script directory
    cd "$(dirname "$0")"
    
    # Set up cleanup
    trap cleanup EXIT
    
    # Detect Python
    detect_python
    
    # Check if we need to set up virtual environment
    USE_VENV=true
    if in_venv; then
        print_success "Already in virtual environment, skipping venv setup"
        USE_VENV=false
    elif [[ "$1" == "--no-venv" ]]; then
        print_warning "Skipping virtual environment setup (--no-venv)"
        USE_VENV=false
    elif [[ "$1" == "--system" ]]; then
        print_warning "Using system Python (--system)"
        USE_VENV=false
    fi
    
    # Set up virtual environment if needed
    if [[ "$USE_VENV" == "true" ]]; then
        if ! setup_venv; then
            print_warning "Virtual environment setup failed, trying with system Python..."
            USE_VENV=false
        else
            CLEANUP_VENV=true
            # Update Python command to use venv
            PYTHON_CMD="python"
        fi
    fi
    
    # Install or check dependencies
    if ! check_dependencies; then
        if ! install_dependencies; then
            print_error "Failed to install dependencies after trying all methods"
            print_error ""
            print_error "Manual steps you can try:"
            print_error "1. Install with package manager:"
            print_error "   - Ubuntu/Debian: sudo apt install python3-aiohttp python3-watchdog"
            print_error "   - macOS: brew install python-aiohttp python-watchdog"
            print_error "2. Use pipx: pipx install aiohttp watchdog"
            print_error "3. Create clean venv: rm -rf venv && python3 -m venv venv && source venv/bin/activate"
            exit 1
        fi
    fi
    
    # Set up directories
    setup_directories
    
    print_success "Setup complete! 🎉"
    echo
    
    # Start the server
    start_server
}

# Handle command line arguments
if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
    echo "Markdown Live View - Automated Setup Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help, -h     Show this help message"
    echo "  --no-venv      Skip virtual environment setup"
    echo "  --system       Use system Python installation"
    echo ""
    echo "Environment Variables:"
    echo "  PORT           Server port (default: 8080)"
    echo "  MARKDOWN_DIR   Directory to watch (default: markdown)"
    echo ""
    echo "Examples:"
    echo "  $0                    # Full automated setup"
    echo "  $0 --no-venv         # Skip virtual environment"
    echo "  PORT=3000 $0         # Use port 3000"
    echo "  MARKDOWN_DIR=docs $0 # Watch 'docs' directory"
    exit 0
fi

# Run main function
main "$@"