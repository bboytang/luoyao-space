# Protocol Package

Shared contracts between Luoyao Space services and runtimes.

Initial domains:

- identity
- events
- capabilities
- tasks
- realtime sessions

Contracts are versioned and transport-agnostic.

## M2 native wire fixtures

`src/m2-wire-fixtures.json` is an implementation-neutral, executable fixture for
Device Session v2 and the first realtime voice wire path. Its JSON objects are
WebSocket **text-message bodies**, not TypeScript instances. The
`binaryAudio.valid.hex` and `binaryAudio.malformed[*].hex` values are complete
WebSocket **binary-message bodies**, encoded as lowercase hexadecimal. The
`trustedServerContext` entry is test-side admission input; it is **never** a
client message or a credential supplied by a device.

The iOS example proposes protocol version 2 and declares `platform: "ios"`.
The server selects only mutually available capabilities. `device.accepted`, not
transport opening or hello transmission, makes the device operational. The
headless example is a valid session with no audio, display, or Avatar. The
rejection has a machine-readable reason. After transport close, the old
session ends; the reconnect example uses a new transport-session ID and does
not represent resume.

The PCM16 example uses an 18-byte `LYA1` header: four magic bytes, one codec
byte (`2` for `pcm_s16le`), big-endian uint32 sample rate, one channel byte,
big-endian uint32 sequence, big-endian uint32 payload length, then signed
little-endian PCM16 samples. The selected format is 24,000 Hz, mono. The
TypeScript fixture tests execute these exact JSON and byte examples; native
Swift XCTest can read the same JSON file without importing TypeScript or Web
code. Transport close and cleanup are lifecycle semantics, not extra wire
messages.

The intended native path is native iOS Swift wire implementation → secure WSS
→ Device Session v2 → Realtime service. The TypeScript client runtime provides
reference behavior and tests; iOS does not embed it or copy the Web UI.
