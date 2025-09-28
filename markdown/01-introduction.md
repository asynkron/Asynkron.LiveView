# Welcome to Markdown Live View

This is the first markdown file in our live view system. This system demonstrates:

## Features

- **Live Updates**: New markdown files are automatically detected and displayed
- **Unified View**: All markdown files are merged in chronological order
- **Rich Rendering**: Supports both markdown and Mermaid diagrams
- **WebSocket Communication**: Real-time updates without page refresh

## Architecture

The system consists of:

1. Python HTTP server with WebSocket support
2. File system watcher for detecting new files
3. HTML template with marked.js and mermaid.js integration
4. Automatic content updates via WebSocket

Let's see this in action!