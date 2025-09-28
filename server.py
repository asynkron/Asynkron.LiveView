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
        self.markdown_dir = Path(markdown_dir)
        self.port = port
        self.clients: set = set()
        self.observer = None
        
        # Ensure markdown directory exists
        self.markdown_dir.mkdir(exist_ok=True)
        
    def get_markdown_files(self) -> List[Dict[str, Any]]:
        """Get all markdown files sorted by creation time."""
        files = []
        
        if not self.markdown_dir.exists():
            return files
            
        for md_file in self.markdown_dir.glob('*.md'):
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
    
    def get_unified_markdown(self) -> str:
        """Get all markdown content unified into a single string."""
        files = self.get_markdown_files()
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
        
        self.clients.add(ws)
        logger.info(f"WebSocket client connected. Total clients: {len(self.clients)}")
        
        try:
            # Send initial content
            unified_content = self.get_unified_markdown()
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
        html_content = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Live View</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: #f8f9fa;
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
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .status.disconnected {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .content {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        pre {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
        }
        code {
            background: #f8f9fa;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Monaco', 'Consolas', monospace;
        }
        pre code {
            background: none;
            padding: 0;
        }
        blockquote {
            border-left: 4px solid #ddd;
            margin: 0;
            padding-left: 20px;
            color: #666;
        }
        .mermaid {
            text-align: center;
            margin: 20px 0;
            background: #f9f9f9;
            border: 1px solid #ddd;
            padding: 10px;
            border-radius: 5px;
        }
        .diagram-error {
            color: #dc3545;
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
        }
        .diagram-placeholder {
            background: #e9ecef;
            border: 1px solid #dee2e6;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
            color: #6c757d;
            text-align: center;
        }
        .diagram-placeholder pre {
            background: #f8f9fa;
            margin-top: 10px;
            text-align: left;
        }
        .content-flash {
            animation: flashIn 0.8s ease-in-out;
        }
        @keyframes flashIn {
            0% { 
                background-color: #fff3cd;
                transform: scale(1.02);
            }
            50% { 
                background-color: #ffeaa7;
                transform: scale(1.01);
            }
            100% { 
                background-color: white;
                transform: scale(1);
            }
        }
        .file-separator {
            border-top: 2px solid #e9ecef;
            margin: 30px 0;
            position: relative;
        }
        .file-separator::after {
            content: attr(data-file);
            position: absolute;
            top: -12px;
            left: 20px;
            background: white;
            padding: 0 10px;
            color: #6c757d;
            font-size: 0.9em;
            font-weight: bold;
        }
        h1, h2, h3, h4, h5, h6 {
            color: #2c3e50;
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
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }
        th {
            background-color: #f2f2f2;
            font-weight: bold;
        }
        .diagram-placeholder {
            background: #e8f4fd;
            border: 2px dashed #4a90e2;
            padding: 20px;
            text-align: center;
            margin: 20px 0;
            border-radius: 5px;
            color: #2c5282;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📄 Markdown Live View</h1>
        <div id="status" class="status disconnected">Connecting...</div>
        <p>This page automatically updates when new markdown files are added to the watched directory.</p>
    </div>
    
    <div id="content" class="content">
        <p>Loading markdown content...</p>
    </div>

    <script src="https://unpkg.com/mermaid@10.6.1/dist/mermaid.min.js"></script>
    <script>
        // Initialize Mermaid with error handling
        let mermaidReady = false;
        try {
            mermaid.initialize({ 
                startOnLoad: false,
                theme: 'default',
                securityLevel: 'loose'
            });
            mermaidReady = true;
        } catch (error) {
            console.warn('Mermaid not available:', error);
        }

        // Simple markdown parser (basic implementation)
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
            
            // Code blocks
            html = html.replace(/```mermaid([\\s\\S]*?)```/gim, function(match, content) {
                const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
                return `<div class="mermaid" id="${id}">${content.trim()}</div>`;
            });
            html = html.replace(/```(\\w+)?([\\s\\S]*?)```/gim, '<pre><code>$2</code></pre>');
            
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
                        // Add timeout protection to prevent hanging
                        const renderPromise = mermaid.render(element.id + '-svg', element.textContent);
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
                    element.innerHTML = `<div class="diagram-placeholder">📊 Mermaid Diagram (requires network access):<br><pre>${element.textContent}</pre></div>`;
                });
            }
        }
        
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            
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
        content = self.get_unified_markdown()
        return web.json_response({
            'content': content,
            'files': [f['name'] for f in self.get_markdown_files()],
            'timestamp': time.time()
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