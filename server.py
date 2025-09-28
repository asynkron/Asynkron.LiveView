#!/usr/bin/env python3
"""
Live View Server for Markdown Files

A simple HTTP server that reads .md files from a folder, serves them as a unified view,
and provides WebSocket support for live updates when new markdown files are added.
"""

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import List, Dict, Any
from urllib.parse import unquote
from aiohttp import web, WSMsgType
from aiohttp.web_response import Response
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MarkdownFileHandler(FileSystemEventHandler):
    """Handles file system events for markdown files."""
    
    def __init__(self, server, loop):
        self.server = server
        self.loop = loop
        super().__init__()
    
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith('.md'):
            logger.info(f"New markdown file detected: {event.src_path}")
            # Schedule the coroutine on the main event loop
            asyncio.run_coroutine_threadsafe(
                self.server.notify_clients_new_file(event.src_path), 
                self.loop
            )

class LiveViewServer:
    """Main server class for the markdown live view system."""
    
    def __init__(self, markdown_dir: str = "markdown", port: int = 8080):
        self.default_markdown_dir = Path(markdown_dir)
        self.markdown_dir = self.default_markdown_dir  # Current active directory
        self.port = port
        self.clients: set = set()
        self.observer = None
        
        # Ensure default markdown directory exists
        self.default_markdown_dir.mkdir(exist_ok=True)
    
    def resolve_markdown_path(self, path_param: str = None) -> Path:
        """Resolve the markdown directory path from various sources."""
        # Priority: query parameter > environment variable > default
        target_path = None
        
        if path_param:
            # Use query parameter path
            target_path = path_param
            logger.info(f"Using path from query parameter: {target_path}")
        elif os.environ.get('LIVEVIEW_PATH'):
            # Use environment variable
            target_path = os.environ.get('LIVEVIEW_PATH')
            logger.info(f"Using path from LIVEVIEW_PATH environment variable: {target_path}")
        
        if target_path:
            # Expand user home directory (~)
            expanded_path = Path(target_path).expanduser().resolve()
            return expanded_path
        else:
            # Use default directory
            return self.default_markdown_dir
    
    def get_fallback_content(self, requested_path: Path) -> str:
        """Generate fallback markdown content when directory is missing or empty."""
        return f"""# 📁 Directory Not Found or Empty

The requested directory could not be accessed or contains no markdown files.

**Requested Path:** `{requested_path}`

## What happened?

- The directory doesn't exist, or
- The directory exists but contains no `.md` files, or  
- There was a permission error accessing the directory

## How to fix this:

1. **Check the path**: Make sure the directory exists and contains `.md` files
2. **Check permissions**: Ensure the server can read the directory
3. **Use query parameter**: Try `?path=/your/markdown/directory`
4. **Use environment variable**: Set `LIVEVIEW_PATH=/your/markdown/directory`

## Examples:

- **Query string**: `http://localhost:8080/?path=~/Documents/notes`
- **Environment variable**: `LIVEVIEW_PATH=~/git/project/docs ./run.sh`

---

*This is a fallback message displayed when the requested directory is not accessible.*
"""
        
    def get_markdown_files(self, custom_path: Path = None) -> List[Dict[str, Any]]:
        """Get all markdown files sorted by creation time."""
        files = []
        target_dir = custom_path if custom_path else self.markdown_dir
        
        if not target_dir.exists():
            logger.warning(f"Directory does not exist: {target_dir}")
            # Return fallback content
            return [{
                'path': target_dir / 'fallback.md',
                'name': 'Directory Not Found',
                'created': time.time(),
                'content': self.get_fallback_content(target_dir)
            }]
            
        md_files = list(target_dir.glob('*.md'))
        if not md_files:
            logger.warning(f"No markdown files found in: {target_dir}")
            # Return fallback content for empty directory
            return [{
                'path': target_dir / 'fallback.md', 
                'name': 'No Markdown Files Found',
                'created': time.time(),
                'content': self.get_fallback_content(target_dir)
            }]
            
        for md_file in md_files:
            try:
                stat = md_file.stat()
                files.append({
                    'path': md_file,
                    'name': md_file.name,
                    'created': stat.st_ctime,
                    'content': md_file.read_text(encoding='utf-8')
                })
            except Exception as e:
                logger.error(f"Error reading file {md_file}: {e}")
                
        # Sort by creation time (newest first)
        files.sort(key=lambda x: x['created'], reverse=True)
        return files
    
    def get_unified_markdown(self, custom_path: Path = None) -> str:
        """Get all markdown content unified into a single string."""
        files = self.get_markdown_files(custom_path)
        unified_content = []
        
        for file_info in files:
            unified_content.append(f"<!-- Source: {file_info['name']} -->")
            unified_content.append(file_info['content'])
            unified_content.append("")  # Add spacing between files
            
        return "\n".join(unified_content)
    
    async def handle_websocket(self, request):
        """Handle WebSocket connections."""
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        
        # Extract path parameter for this WebSocket connection
        path_param = request.query.get('path')
        if path_param:
            path_param = unquote(path_param)
        target_path = self.resolve_markdown_path(path_param)
        
        self.clients.add(ws)
        logger.info(f"WebSocket client connected. Total clients: {len(self.clients)}")
        
        try:
            # Send initial content from the resolved path
            unified_content = self.get_unified_markdown(target_path)
            await ws.send_str(json.dumps({
                'type': 'initial',
                'content': unified_content
            }))
            
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        if data.get('type') == 'ping':
                            await ws.send_str(json.dumps({'type': 'pong'}))
                    except json.JSONDecodeError:
                        logger.warning("Received invalid JSON from client")
                elif msg.type == WSMsgType.ERROR:
                    logger.error(f"WebSocket error: {ws.exception()}")
                    
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            self.clients.discard(ws)
            logger.info(f"WebSocket client disconnected. Total clients: {len(self.clients)}")
            
        return ws
    
    async def notify_clients_new_file(self, file_path: str):
        """Notify all connected clients about new file."""
        if not self.clients:
            return
            
        try:
            # Wait a moment for file to be fully written
            await asyncio.sleep(0.1)
            
            unified_content = self.get_unified_markdown()
            message = json.dumps({
                'type': 'update',
                'content': unified_content,
                'new_file': Path(file_path).name
            })
            
            # Send to all connected clients
            disconnected_clients = set()
            for client in self.clients:
                try:
                    await client.send_str(message)
                except Exception as e:
                    logger.error(f"Error sending to client: {e}")
                    disconnected_clients.add(client)
            
            # Remove disconnected clients
            self.clients -= disconnected_clients
            
        except Exception as e:
            logger.error(f"Error notifying clients: {e}")
    
    async def handle_index(self, request):
        """Serve the main HTML page."""
        # Check for path parameter in query string
        path_param = request.query.get('path')
        if path_param:
            # URL decode the path parameter
            path_param = unquote(path_param)
        
        # Resolve the target directory
        target_path = self.resolve_markdown_path(path_param)
        logger.info(f"Serving content from: {target_path}")
        
        html_content = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown + Mermaid Live Viewer</title>
    <style>
        body {
            font-family: sans-serif;
            margin: 0;
            padding: 0;
            height: 100vh;
            background-color: #121a22;
            color: #ddd;
            font-size: smaller;
        }
        .mermaid {
            background-color: #121a22 !important;
        }

        .mermaid svg {
            background-color: #121a22 !important;
        }

        #mmd-0 .cluster rect {
            fill: hsl(180deg 1.59% 28.35% / 12%) !important;
        }

        #viewer {
            padding: 20px;
            overflow-y: auto;
        }

        #editor {
            display: none;
        }

        .header {
            background: #1e1e1e;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #007bff;
        }
        .status {
            margin-bottom: 10px;
            padding: 10px;
            border-radius: 4px;
            font-weight: bold;
        }
        .status.connected {
            background: #2d4a2d;
            color: #90ee90;
            border: 1px solid #4a6b4a;
        }
        .status.disconnected {
            background: #4a2d2d;
            color: #ffb3b3;
            border: 1px solid #6b4a4a;
        }
        .content {
            background: #121a22;
            padding: 20px;
            border-radius: 8px;
        }
        pre {
            background: #2d2d2d;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
        }
        code {
            background: #2d2d2d;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Monaco', 'Consolas', monospace;
        }
        pre code {
            background: #2d2d2d;
            padding: 10px;
            border-radius: 4px;
            display: block;
            overflow-x: auto;
        }
        blockquote {
            border-left: 4px solid #666;
            margin: 0;
            padding-left: 20px;
            color: #aaa;
        }
        .mermaid {
            text-align: center;
            margin: 20px 0;
            background: #1e1e1e;
            border: 1px solid #444;
            padding: 10px;
            border-radius: 5px;
            color: #ddd;
        }
        .mermaid svg {
            background: #1e1e1e;
        }
        .diagram-error {
            color: #ffb3b3;
            background: #3b1f1f;
            border: 1px solid #7a2a2a;
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
        }
        .mmd-error {
            background: #3b1f1f;
            color: #ffb3b3;
            border: 1px solid #7a2a2a;
            padding: 10px;
            border-radius: 4px;
            white-space: pre-wrap;
        }
        .diagram-placeholder {
            background: #2d2d2d;
            border: 1px solid #555;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
            color: #aaa;
            text-align: center;
        }
        .diagram-placeholder pre {
            background: #1e1e1e;
            margin-top: 10px;
            text-align: left;
        }
        .content-flash {
            animation: flashIn 0.8s ease-in-out;
        }
        @keyframes flashIn {
            0% { 
                background-color: #2d3e2d;
                transform: scale(1.02);
            }
            50% { 
                background-color: #3d4e3d;
                transform: scale(1.01);
            }
            100% { 
                background-color: #121a22;
                transform: scale(1);
            }
        }
        .file-separator {
            border-top: 2px solid #444;
            margin: 30px 0;
            position: relative;
        }
        .file-separator::after {
            content: attr(data-file);
            position: absolute;
            top: -12px;
            left: 20px;
            background: #121a22;
            padding: 0 10px;
            color: #888;
            font-size: 0.9em;
            font-weight: bold;
        }
        h1, h2, h3, h4, h5, h6 {
            color: #ddd;
            margin-top: 30px;
            margin-bottom: 15px;
        }
        ul, ol {
            margin: 15px 0;
            padding-left: 30px;
        }
        li {
            margin: 5px 0;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 20px 0;
        }
        th, td {
            border: 1px solid #444;
            padding: 12px;
            text-align: left;
        }
        th {
            background-color: #2d2d2d;
            font-weight: bold;
        }
        .diagram-placeholder {
            background: #2d2d2d;
            border: 2px dashed #555;
            padding: 20px;
            text-align: center;
            margin: 20px 0;
            border-radius: 5px;
            color: #aaa;
            font-style: italic;
        }
    </style>
    <script src="https://unpkg.com/mermaid@10.6.1/dist/mermaid.min.js"></script>
</head>
<body>
    <div id="viewer">
        <div class="header">
            <h1>📄 Markdown + Mermaid Live Viewer</h1>
            <div id="status" class="status disconnected">Connecting...</div>
            <p>This page automatically updates when new markdown files are added to the watched directory.</p>
            <p><strong>📁 Current Directory:</strong> <code>""" + str(target_path) + """</code></p>
        </div>
        
        <div id="content" class="content">
            <p>Loading markdown content...</p>
        </div>
    </div>

    <script src="https://unpkg.com/mermaid@10.6.1/dist/mermaid.min.js"></script>
    <script>
        // Initialize Mermaid with dark theme
        let mermaidReady = false;
        
        function initializeMermaid() {
            if (typeof mermaid !== 'undefined') {
                try {
                    mermaid.initialize({ 
                        startOnLoad: false,
                        theme: 'dark',
                        securityLevel: 'loose'
                    });
                    mermaidReady = true;
                    console.log('Mermaid initialized successfully');
                } catch (error) {
                    console.warn('Mermaid initialization failed:', error);
                    mermaidReady = false;
                }
            }
        }
        
        // Try to initialize immediately
        initializeMermaid();
        
        // If not loaded yet, wait for window load event
        if (!mermaidReady) {
            window.addEventListener('load', () => {
                setTimeout(initializeMermaid, 100);
            });
        }

        // Simple markdown parser (enhanced for dark theme)
        function parseMarkdown(md) {
            let html = md;
            
            // Headers
            html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
            html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
            html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
            
            // Bold
            html = html.replace(/\\*\\*(.*?)\\*\\*/gim, '<strong>$1</strong>');
            
            // Italic
            html = html.replace(/\\*(.*?)\\*/gim, '<em>$1</em>');
            
            // Code blocks with language detection
            html = html.replace(/```mermaid([\\s\\S]*?)```/gim, function(match, content) {
                const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
                const cleanContent = content.trim();
                const encodedContent = btoa(cleanContent);
                return `<div class="mermaid" id="${id}" data-mermaid-source="${encodedContent}">${cleanContent}</div>`;
            });
            html = html.replace(/```(\\w+)?([\\s\\S]*?)```/gim, '<pre><code class="language-$1">$2</code></pre>');
            
            // Inline code
            html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');
            
            // Links
            html = html.replace(/\\[([^\\]]+)\\]\\(([^\\)]+)\\)/gim, '<a href="$2">$1</a>');
            
            // Lists
            html = html.replace(/^\\s*[-\\*\\+] (.*)$/gim, '<li>$1</li>');
            html = html.replace(/((<li>.*<\\/li>\\n?)+)/gim, '<ul>$1</ul>');
            
            // Blockquotes
            html = html.replace(/^> (.*)$/gim, '<blockquote>$1</blockquote>');
            
            // Line breaks
            html = html.replace(/\\n\\n/gim, '</p><p>');
            html = html.replace(/\\n/gim, '<br>');
            
            // Wrap in paragraphs
            html = '<p>' + html + '</p>';
            
            // Clean up empty paragraphs
            html = html.replace(/<p><\\/p>/gim, '');
            html = html.replace(/<p>(<h[1-6]>)/gim, '$1');
            html = html.replace(/(<\\/h[1-6]>)<\\/p>/gim, '$1');
            html = html.replace(/<p>(<ul>)/gim, '$1');
            html = html.replace(/(<\\/ul>)<\\/p>/gim, '$1');
            html = html.replace(/<p>(<pre>)/gim, '$1');
            html = html.replace(/(<\\/pre>)<\\/p>/gim, '$1');
            html = html.replace(/<p>(<blockquote>)/gim, '$1');
            html = html.replace(/(<\\/blockquote>)<\\/p>/gim, '$1');
            html = html.replace(/<p>(<div)/gim, '$1');
            html = html.replace(/(<\\/div>)<\\/p>/gim, '$1');
            
            return html;
        }
        
        let ws = null;
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;
        
        function updateStatus(connected, message = '') {
            const statusEl = document.getElementById('status');
            if (connected) {
                statusEl.className = 'status connected';
                statusEl.textContent = '🟢 Connected' + (message ? ` - ${message}` : '');
                reconnectAttempts = 0;
            } else {
                statusEl.className = 'status disconnected';
                statusEl.textContent = '🔴 Disconnected' + (message ? ` - ${message}` : '');
            }
        }
        
        function renderMarkdown(content) {
            // Split content by file separators and process
            const parts = content.split(/<!-- Source: (.+?) -->/);
            let html = '';
            
            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 1) {
                    // This is a filename
                    html += `<div class="file-separator" data-file="${parts[i]}"></div>`;
                } else if (parts[i].trim()) {
                    // This is content - parse markdown
                    html += parseMarkdown(parts[i].trim());
                }
            }
            
            return html;
        }
        
        async function updateContent(content, isNewContent = false) {
            const contentEl = document.getElementById('content');
            const html = renderMarkdown(content);
            contentEl.innerHTML = html;
            
            // Add flash effect for new content
            if (isNewContent) {
                contentEl.classList.add('content-flash');
                setTimeout(() => {
                    contentEl.classList.remove('content-flash');
                }, 800);
            }
            
            // Render Mermaid diagrams with proper async handling
            const mermaidElements = contentEl.querySelectorAll('.mermaid');
            if (mermaidReady && typeof mermaid !== 'undefined') {
                // Process diagrams sequentially to avoid UI blocking
                for (const element of mermaidElements) {
                    try {
                        // Get clean source content from data attribute or fallback to textContent
                        let sourceContent = '';
                        if (element.hasAttribute('data-mermaid-source')) {
                            // Decode from Base64
                            sourceContent = atob(element.getAttribute('data-mermaid-source'));
                        } else {
                            // Fallback for corrupted content
                            sourceContent = element.textContent.replace(/^📊 Mermaid Diagram \\(requires network access\\):/, '').trim();
                        }
                        
                        // Skip if content is empty or corrupted
                        if (!sourceContent || sourceContent.includes('📊 Mermaid Diagram')) {
                            continue;
                        }
                        
                        // Add timeout protection to prevent hanging
                        const renderPromise = mermaid.render(element.id + '-svg', sourceContent);
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Mermaid rendering timeout')), 5000)
                        );
                        
                        const { svg } = await Promise.race([renderPromise, timeoutPromise]);
                        element.innerHTML = svg;
                    } catch (error) {
                        console.error('Error rendering Mermaid diagram:', error);
                        element.innerHTML = `<div class="diagram-error">Error rendering diagram: ${error.message}</div>`;
                    }
                }
            } else {
                // Fallback for when Mermaid is not available
                mermaidElements.forEach((element) => {
                    let sourceContent = '';
                    if (element.hasAttribute('data-mermaid-source')) {
                        // Decode from Base64
                        sourceContent = atob(element.getAttribute('data-mermaid-source'));
                    } else {
                        sourceContent = element.textContent;
                    }
                    element.innerHTML = `<div class="diagram-placeholder">📊 Mermaid Diagram (requires network access):<br><pre>${sourceContent}</pre></div>`;
                });
            }
        }
        
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            let wsUrl = `${protocol}//${window.location.host}/ws`;
            
            // Add query parameters to WebSocket URL if present in current URL
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('path')) {
                wsUrl += `?path=${encodeURIComponent(urlParams.get('path'))}`;
            }
            
            updateStatus(false, 'Connecting...');
            
            ws = new WebSocket(wsUrl);
            
            ws.onopen = function() {
                updateStatus(true);
                console.log('WebSocket connected');
            };
            
            ws.onmessage = async function(event) {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'initial') {
                        await updateContent(data.content, false);
                        updateStatus(true, 'Content loaded');
                    } else if (data.type === 'update') {
                        await updateContent(data.content, true);
                        updateStatus(true, `Updated: ${data.new_file}`);
                        
                        // Flash notification
                        setTimeout(() => updateStatus(true), 3000);
                    } else if (data.type === 'pong') {
                        console.log('Pong received');
                    }
                } catch (e) {
                    console.error('Error parsing WebSocket message:', e);
                }
            };
            
            ws.onclose = function() {
                updateStatus(false, 'Connection closed');
                console.log('WebSocket disconnected');
                
                if (reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    setTimeout(() => {
                        console.log(`Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`);
                        connectWebSocket();
                    }, 2000 * reconnectAttempts);
                } else {
                    updateStatus(false, 'Max reconnection attempts reached');
                }
            };
            
            ws.onerror = function(error) {
                console.error('WebSocket error:', error);
                updateStatus(false, 'Connection error');
            };
        }
        
        // Connect WebSocket
        connectWebSocket();
        
        // Keep connection alive
        setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({type: 'ping'}));
            }
        }, 30000);
    </script>
</body>
</html>
        """
        return web.Response(text=html_content, content_type='text/html')
    
    async def handle_api_content(self, request):
        """API endpoint to get unified markdown content."""
        # Extract path parameter
        path_param = request.query.get('path')
        if path_param:
            path_param = unquote(path_param)
        target_path = self.resolve_markdown_path(path_param)
        
        content = self.get_unified_markdown(target_path)
        return web.json_response({
            'content': content,
            'files': [f['name'] for f in self.get_markdown_files(target_path)],
            'timestamp': time.time(),
            'directory': str(target_path)
        })
    
    def start_file_watcher(self, loop):
        """Start watching the markdown directory for changes."""
        self.observer = Observer()
        event_handler = MarkdownFileHandler(self, loop)
        self.observer.schedule(event_handler, str(self.markdown_dir), recursive=False)
        self.observer.start()
        logger.info(f"Started watching directory: {self.markdown_dir}")
    
    def stop_file_watcher(self):
        """Stop the file watcher."""
        if self.observer:
            self.observer.stop()
            self.observer.join()
            logger.info("File watcher stopped")
    
    async def run(self):
        """Run the server."""
        app = web.Application()
        
        # Routes
        app.router.add_get('/', self.handle_index)
        app.router.add_get('/ws', self.handle_websocket)
        app.router.add_get('/api/content', self.handle_api_content)
        
        # Get the current event loop
        loop = asyncio.get_event_loop()
        
        # Start file watcher
        self.start_file_watcher(loop)
        
        try:
            logger.info(f"Starting server on http://localhost:{self.port}")
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, 'localhost', self.port)
            await site.start()
            
            logger.info(f"Server running at http://localhost:{self.port}")
            logger.info(f"Watching markdown files in: {self.markdown_dir.absolute()}")
            
            # Keep the server running
            while True:
                await asyncio.sleep(1)
                
        except KeyboardInterrupt:
            logger.info("Server shutting down...")
        finally:
            self.stop_file_watcher()

def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Markdown Live View Server')
    parser.add_argument('--dir', default='markdown', help='Directory to watch for markdown files')
    parser.add_argument('--port', type=int, default=8080, help='Port to run server on')
    
    args = parser.parse_args()
    
    server = LiveViewServer(args.dir, args.port)
    
    try:
        asyncio.run(server.run())
    except KeyboardInterrupt:
        logger.info("Server stopped by user")

if __name__ == '__main__':
    main()