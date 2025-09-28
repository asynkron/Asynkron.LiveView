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
    <title>Markdown Live View</title>
    <style>
    body {
      font-family: sans-serif;
      margin: 0;
      padding: 20px;
      min-height: 100vh;
      background-color: #121a22;
      color: #ddd;
      font-size: 14px;
      line-height: 1.6;
    }

    .content {
      max-width: 1200px;
      margin: 0 auto;
    }

    .status {
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1000;
    }

    .status.connected {
      background-color: #1f2937;
      color: #10b981;
      border: 1px solid #10b981;
    }

    .status.disconnected {
      background-color: #1f2937;
      color: #ef4444;
      border: 1px solid #ef4444;
    }

    .content-flash {
      animation: flash 0.8s ease-out;
    }

    @keyframes flash {
      0% { background-color: #374151; }
      100% { background-color: transparent; }
    }

    .file-separator {
      margin: 2rem 0;
      padding: 0.5rem;
      background-color: #1f2937;
      border-left: 4px solid #3b82f6;
      border-radius: 4px;
      font-size: 12px;
      opacity: 0.7;
    }

    .file-separator::before {
      content: "📄 ";
    }

    h1, h2, h3, h4, h5, h6 {
      color: #f9fafb;
      margin-top: 2rem;
      margin-bottom: 1rem;
    }

    h1 { border-bottom: 2px solid #374151; padding-bottom: 0.3rem; }
    h2 { border-bottom: 1px solid #374151; padding-bottom: 0.3rem; }

    p {
      margin-bottom: 1rem;
    }

    pre {
      background: #1f2937;
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      border: 1px solid #374151;
    }

    pre code {
      background: transparent;
      padding: 0;
      border-radius: 0;
      display: block;
      overflow-x: auto;
    }

    code {
      background: #1f2937;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-size: 0.9em;
      border: 1px solid #374151;
    }

    blockquote {
      border-left: 4px solid #6b7280;
      margin: 1rem 0;
      padding-left: 1rem;
      color: #9ca3af;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }

    th, td {
      border: 1px solid #374151;
      padding: 0.5rem;
      text-align: left;
    }

    th {
      background-color: #1f2937;
    }

    .mermaid {
      background-color: #121a22 !important;
      text-align: center;
      margin: 1rem 0;
    }

    .mermaid svg {
      background-color: #121a22 !important;
      max-width: 100%;
      height: auto;
    }

    .diagram-placeholder, .diagram-error {
      background: #1f2937;
      border: 1px solid #374151;
      padding: 1rem;
      border-radius: 4px;
      margin: 1rem 0;
      text-align: center;
    }

    .diagram-error {
      background: #3b1f1f;
      color: #ffb3b3;
      border-color: #7a2a2a;
    }
  </style>
</head>
<body>
    <div id="status" class="status disconnected">🔴 Disconnected</div>
    <div class="content">
        <p><strong>📁 Current Directory:</strong> <code>""" + str(target_path) + """</code></p>   
        <div id="content">
            <p>Loading markdown content...</p>
        </div>
    </div>

    <script src="https://unpkg.com/mermaid@10.6.1/dist/mermaid.min.js"></script>
    <script>
        // Simple self-contained markdown parser (no external dependencies)
        let mermaidReady = false;

        // Initialize Mermaid with proper error handling
        function initializeMermaid() {
            if (typeof mermaid !== 'undefined') {
                try {
                    mermaid.initialize({ 
                        startOnLoad: false,
                        theme: 'dark',
                        securityLevel: 'loose',
                        themeVariables: {
                            background: '#121a22',
                            primaryColor: '#3b82f6',
                            primaryTextColor: '#f9fafb',
                            primaryBorderColor: '#374151',
                            lineColor: '#6b7280',
                            secondaryColor: '#1f2937',
                            tertiaryColor: '#374151'
                        }
                    });
                    mermaidReady = true;
                    console.log('Mermaid initialized successfully');
                } catch (error) {
                    console.warn('Mermaid initialization failed:', error);
                    mermaidReady = false;
                }
            } else {
                console.warn('Mermaid not available');
                mermaidReady = false;
            }
        }

        // Try to initialize immediately if already loaded
        initializeMermaid();
        
        // If not loaded yet, wait for window load event
        window.addEventListener('load', () => {
            setTimeout(initializeMermaid, 100);
        });

        function parseMarkdown(md) {
            // Simple but effective markdown parser
            let html = md;
            
            // Handle code blocks first (to avoid interfering with other patterns)
            html = html.replace(/```mermaid\\n([\\s\\S]*?)```/g, '<div class="mermaid">$1</div>');
            html = html.replace(/```(\\w+)?\\n([\\s\\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
            html = html.replace(/```([\\s\\S]*?)```/g, '<pre><code>$1</code></pre>');
            
            // Headers
            html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
            html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
            html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
            
            // Bold and italic
            html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
            html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
            
            // Inline code
            html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
            
            // Links
            html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
            
            // Blockquotes
            html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');
            
            // Lists (simple implementation)
            html = html.replace(/^\\* (.*$)/gm, '<ul><li>$1</li></ul>');
            html = html.replace(/^\\d+\\. (.*$)/gm, '<ol><li>$1</li></ol>');
            
            // Line breaks and paragraphs
            html = html.replace(/\\n\\n/g, '</p><p>');
            html = html.replace(/\\n/g, '<br>');
            
            // Wrap in paragraphs if not already wrapped in block elements
            if (!html.startsWith('<h') && !html.startsWith('<p') && !html.startsWith('<div') && !html.startsWith('<pre') && !html.startsWith('<ul') && !html.startsWith('<ol') && !html.startsWith('<blockquote')) {
                html = '<p>' + html + '</p>';
            }
            
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
                    html += `<div class="file-separator" data-file="${parts[i]}">${parts[i]}</div>`;
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
            if (mermaidReady && typeof mermaid !== 'undefined' && mermaidElements.length > 0) {
                // Process diagrams sequentially to avoid UI blocking
                for (let i = 0; i < mermaidElements.length; i++) {
                    const element = mermaidElements[i];
                    try {
                        const sourceContent = element.textContent.trim();
                        
                        // Skip if content is empty
                        if (!sourceContent) {
                            continue;
                        }
                        
                        // Generate unique ID for this diagram
                        const diagramId = 'mermaid-' + Date.now() + '-' + i;
                        
                        // Add timeout protection to prevent hanging
                        const renderPromise = mermaid.render(diagramId, sourceContent);
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Mermaid rendering timeout')), 5000)
                        );
                        
                        const { svg } = await Promise.race([renderPromise, timeoutPromise]);
                        element.innerHTML = svg;
                    } catch (error) {
                        console.error('Error rendering Mermaid diagram:', error);
                        element.innerHTML = `<div class="diagram-error">⚠️ Error rendering diagram: ${error.message}</div>`;
                    }
                }
            } else if (mermaidElements.length > 0) {
                // Fallback for when Mermaid is not available
                mermaidElements.forEach((element) => {
                    const sourceContent = element.textContent.trim();
                    element.innerHTML = `<div class="diagram-placeholder">📊 Mermaid Diagram (loading...):<br><pre>${sourceContent}</pre></div>`;
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