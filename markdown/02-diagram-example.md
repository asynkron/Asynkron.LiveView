# System Architecture Diagram

Here's a Mermaid diagram showing how the live view system works:

```mermaid
graph TD
    A[Markdown Files] --> B[File Watcher]
    B --> C[Python Server]
    C --> D[WebSocket]
    D --> E[HTML Client]
    E --> F[marked.js]
    E --> G[mermaid.js]
    F --> H[Rendered Content]
    G --> H
    
    C --> I[HTTP Endpoint]
    I --> E
    
    style A fill:#e1f5fe
    style H fill:#c8e6c9
    style C fill:#fff3e0
```

## Flow Description

1. **File Detection**: Watchdog monitors the markdown directory
2. **Content Processing**: Server reads and orders files by creation time
3. **Live Updates**: WebSocket pushes updates to connected clients
4. **Rendering**: Client-side JavaScript renders markdown and diagrams