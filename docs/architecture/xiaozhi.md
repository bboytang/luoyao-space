# XiaoZhi Runtime Research

XiaoZhi is a major source for the realtime/device layer.

Relevant concepts identified during source review:

- WebSocket session protocol
- JSON control messages plus binary Opus audio
- VAD / ASR / LLM / TTS pipeline
- streaming sentence events
- TTS start / sentence_start / stop events
- abort for barge-in
- MCP tools/list and tools/call
- device capability registration
- digital-human event bridging

## Reuse strategy

Reuse concepts and compatible MIT-licensed code selectively.

Do not copy the complete XiaoZhi server into the core product. Keep a thin compatibility runtime under:

```
runtimes/xiaozhi/
```

Bundled third-party character assets require separate license review and must not be assumed to be covered by the repository's MIT code license.
