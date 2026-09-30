# Cross-platform runtime boundary

Luoyao Space treats device I/O as adapters around provider-neutral runtime contracts.

## Platform targets

The same Realtime Device Runtime is designed to support:

- Web browsers
- iOS / iPadOS
- Android
- macOS
- Windows
- embedded Linux / dedicated hardware

Platform-specific audio, microphone, permissions, lifecycle, rendering, and device APIs must stay in adapters. Core Realtime, Brain, Memory, protocol, and Avatar logic must not import platform SDKs.

## Audio boundary

The audio-io contract defines the platform-neutral input/output lifecycle:

- RealtimeAudioInput.start() emits normalized AudioFrame values.
- RealtimeAudioInput.stop() releases capture resources.
- RealtimeAudioOutput.play() consumes normalized AudioFrame values.
- RealtimeAudioOutput.stop() stops and releases playback resources.

The Web implementation lives under apps/web. Native and embedded implementations can provide the same contracts without changing Realtime or Brain.

## Avatar boundary

runtimes/avatar owns provider-neutral character state, expression, motion, and lip-sync inputs. A platform renderer is responsible for turning that state into pixels, native views, a game/3D engine, or a device display.

## Product consequence

A platform port should primarily replace adapters rather than fork Luoyao's conversation, memory, realtime, or avatar semantics.
