# Realtime Service

Owns realtime conversational sessions.

Target pipeline:

audio input
-> VAD
-> ASR / realtime model
-> streaming response
-> sentence segmentation
-> TTS
-> audio output

Supports:

- streaming
- interruption / barge-in
- abort
- session state
- emotion events
- runtime adapters
