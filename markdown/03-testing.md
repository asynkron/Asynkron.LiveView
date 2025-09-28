# Testing Live Updates

This file was created to test the live update functionality!

## Code Example

Here's some Python code:

```python
def hello_world():
    print("Hello from the live view system!")
    return "success"

# This should trigger a live update
hello_world()
```

## Mermaid Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant FileSystem
    participant Server
    participant WebSocket
    participant Browser

    User->>FileSystem: Create new .md file
    FileSystem->>Server: File change event
    Server->>Server: Read and process file
    Server->>WebSocket: Send update message
    WebSocket->>Browser: Push new content
    Browser->>Browser: Re-render page
```

## Status: ✅ Live Update Test Successful!