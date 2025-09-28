# Asynkron.LiveView

A live view system for markdown files that automatically detects, orders, and displays markdown content with real-time updates via WebSocket.

## Features

- 📄 **Unified Markdown View**: Reads `.md` files from a folder and displays them as a single, unified document
- ⏰ **Chronological Ordering**: Files are automatically ordered by creation timestamp
- 🔄 **Live Updates**: Real-time detection of new markdown files with WebSocket streaming
- 🎨 **Rich Rendering**: Full support for markdown syntax and Mermaid diagrams
- 🌐 **Web Interface**: Clean, responsive HTML interface with marked.js and mermaid.js

## Quick Start

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

## Usage

### Command Line Options

```bash
python server.py --help
```

- `--dir DIRECTORY`: Specify the directory to watch for markdown files (default: `markdown`)
- `--port PORT`: Set the server port (default: `8080`)

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
- `GET /ws`: WebSocket endpoint for live updates
- `GET /api/content`: JSON API returning unified markdown content

## File Structure

```
Asynkron.LiveView/
├── server.py          # Main server implementation
├── start.py           # Simple startup script
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

If you encounter dependency installation issues:

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

The `start.py` script automatically handles most installation scenarios and provides helpful guidance.

## Browser Support

The web interface uses modern JavaScript and should work in all current browsers. The system loads:

- **marked.js**: For markdown parsing and rendering
- **mermaid.js**: For diagram rendering
- **WebSocket API**: For real-time updates

## Contributing

Feel free to submit issues and pull requests to improve the system!