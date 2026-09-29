<!--
Design Reference

Inspired by: XiaoZhi open-source realtime/device implementations
License reference: MIT

This document records research and design references for Luoyao Space.
It is not copied upstream code.
-->

# Realtime / Device Runtime Research

This document records reusable realtime and device-runtime patterns identified from external open-source implementations.

Relevant concepts:

- WebSocket session protocol
- JSON control messages plus binary audio
- VAD / ASR / LLM / TTS pipeline
- streaming sentence events
- TTS start / sentence_start / stop events
- abort for barge-in
- MCP tools/list and tools/call
- device capability registration
- digital-human event bridging

## Reuse strategy

Reuse concepts and compatible code selectively.

Do not copy a complete external server or product architecture into Luoyao Space. Keep the integration behind Luoyao Space runtime interfaces so the core product remains provider- and runtime-independent.

Bundled third-party character assets require separate license review and must not be assumed to be covered by the source repository's code license.
