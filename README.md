# Asynkron.LiveView

A live view system for markdown files that automatically detects, orders, and displays markdown content with real-time updates via WebSocket.

## Features

- 📄 **Unified Markdown View**: Reads `.md` files from a folder and displays them as a single, unified document
- ⏰ **Chronological Ordering**: Files are automatically ordered by creation timestamp
- 🔄 **Live Updates**: Real-time detection of new markdown files with WebSocket streaming
- 🎨 **Rich Rendering**: Full support for markdown syntax and Mermaid diagrams
- 🌐 **Web Interface**: Clean, responsive HTML interface with marked.js and mermaid.js

## Quick Start

### ⚡ **One-Command Setup (Recommended)**

```bash
./run.sh
```

That's it! The script will automatically:
- ✅ Detect your Python installation
- ✅ Set up a virtual environment 
- ✅ Install all dependencies
- ✅ Create the markdown directory
- ✅ Start the server at `http://localhost:8080`

### 🔧 **Manual Setup**

If you prefer manual setup:

1. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the Server**:
   ```bash
   python start.py
   ```
   
   Or directly:
   ```bash
   python server.py
   ```

3. **Open Your Browser**:
   Navigate to `http://localhost:8080`

4. **Add Markdown Files**:
   Drop `.md` files into the `markdown/` directory and watch them appear automatically!

### 🛠️ **Script Options**

The `run.sh` script supports several options for different environments:

```bash
# Full automated setup (creates virtual environment)
./run.sh

# Skip virtual environment, use system Python
./run.sh --system

# Skip virtual environment setup entirely  
./run.sh --no-venv

# Use custom port
PORT=3000 ./run.sh

# Watch different directory
MARKDOWN_DIR=docs ./run.sh

# Show help
./run.sh --help
```

The script automatically handles:
- 🐍 **Python Detection**: Finds Python 3.7+ automatically
- 📦 **Dependency Management**: Tries multiple installation strategies
- 🏠 **Environment Setup**: Creates isolated virtual environment
- 🔧 **Error Recovery**: Graceful fallbacks for different system configurations
- 🍎 **Cross-Platform**: Works on Linux, macOS, and WSL

## Usage

### Command Line Options

```bash
python server.py --help
```

- `--dir DIRECTORY`: Specify the directory to watch for markdown files (default: `markdown`)
- `--port PORT`: Set the server port (default: `8080`)

### Dynamic Path Support

The server now supports pointing to different directories in multiple ways:

#### 1. Query Parameter (Highest Priority)

Navigate to any directory using the `path` query parameter:

```bash
# Point to a specific directory
http://localhost:8080/?path=/path/to/your/markdown/files

# Use tilde expansion for home directory  
http://localhost:8080/?path=~/Documents/notes

# Example from the original request
http://localhost:8080/?path=~/git/asynkron/Asynkron.DurableFunctions/Logs
```

#### 2. Environment Variable (Fallback)

Set the `LIVEVIEW_PATH` environment variable:

```bash
# Using the script
LIVEVIEW_PATH=~/git/project/docs ./run.sh

# Using the server directly
LIVEVIEW_PATH=/path/to/markdown python server.py
```

#### 3. Command Line Argument (Default)

Use the traditional `--dir` argument:

```bash
python server.py --dir /path/to/markdown --port 3000
```

### Priority Order

1. Query parameter (`?path=...`)
2. Environment variable (`LIVEVIEW_PATH`)  
3. Command line argument (`--dir`)
4. Default (`markdown/`)

### Fallback Behavior

When the specified directory is missing or empty, the server displays helpful markdown content explaining:
- What went wrong
- How to fix the issue
- Usage examples
- Alternative methods to specify paths

### Example

```bash
python server.py --dir /path/to/my/docs --port 3000
```

## How It Works

1. **File Monitoring**: Uses `watchdog` to monitor the markdown directory for new `.md` files
2. **Content Merging**: Reads all markdown files and orders them by creation timestamp
3. **WebSocket Updates**: Pushes real-time updates to all connected browser clients
4. **Client Rendering**: Browser renders unified content using marked.js for markdown and mermaid.js for diagrams

## API Endpoints

- `GET /`: Main web interface
  - Query parameter: `?path=/path/to/directory` - Specify custom directory
- `GET /ws`: WebSocket endpoint for live updates
  - Query parameter: `?path=/path/to/directory` - Specify custom directory for WebSocket connection  
- `GET /api/content`: JSON API returning unified markdown content
  - Query parameter: `?path=/path/to/directory` - Specify custom directory
  - Returns: `{content, files, timestamp, directory}`

### Usage Examples

```bash
# Start server with default directory
./run.sh

# Start server with environment variable
LIVEVIEW_PATH=~/Documents/notes ./run.sh

# Start server on custom port with custom directory
LIVEVIEW_PATH=/var/log/markdown PORT=3000 ./run.sh

# Access different directories via URL
curl "http://localhost:8080/api/content?path=~/git/project/docs"
```

## File Structure

```
Asynkron.LiveView/
├── server.py          # Main server implementation
├── start.py           # Simple startup script
├── run.sh             # Automated setup script (recommended)
├── requirements.txt   # Python dependencies
├── markdown/          # Directory for markdown files
│   ├── 01-intro.md   # Sample files (ordered by timestamp)
│   └── 02-diagram.md
└── README.md
```

## Dependencies

- `aiohttp`: Async HTTP server and WebSocket support
- `websockets`: WebSocket protocol implementation
- `watchdog`: File system monitoring

## Installation Troubleshooting

**🚀 The easiest way to avoid all setup issues is to use the automated script:**
```bash
./run.sh
```

If you encounter dependency installation issues with manual setup:

### Externally-Managed Environment (e.g., Homebrew Python)
```bash
# Use virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Or install to user directory
pip install --user -r requirements.txt
```

### System Installation Issues
```bash
# For systems that require explicit permission
pip install --break-system-packages -r requirements.txt

# Or use system package manager (Ubuntu/Debian)
sudo apt install python3-aiohttp python3-watchdog
```

The `start.py` script and `run.sh` script both automatically handle most installation scenarios and provide helpful guidance.

## Browser Support

The web interface uses modern JavaScript and should work in all current browsers. The system loads:

- **marked.js**: For markdown parsing and rendering
- **mermaid.js**: For diagram rendering
- **WebSocket API**: For real-time updates

## Contributing

Feel free to submit issues and pull requests to improve the system!