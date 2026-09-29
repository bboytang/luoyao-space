# Tool Runtime

Executes registered capabilities.

The model may request a capability, but execution always passes through:

authentication -> permission -> risk policy -> approval -> backend -> audit

Supported backend protocols can include:

- MCP
- HTTP
- WebSocket
- native OS APIs
- SSH
- provider-specific APIs
