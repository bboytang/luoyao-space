# Native iOS Device Session and realtime audio host (M2-C1/C2)

This is Luoyao's first native host: SwiftUI for the minimal diagnostic UI and
Foundation `URLSessionWebSocketTask` for WSS. It independently implements the
platform-neutral Device Session v2 wire contract; it does not embed Web, the
TypeScript runtime, Brain, or Avatar. Web remains a
reference/debug/integration host, not an iOS UI template.

The app targets iOS 17.0 or newer. It stores a stable *declared* device ID in
UserDefaults. The native AVAudioSession/AVAudioEngine adapters offer 24 kHz,
mono PCM16 input/output according to microphone permission and the current
audio route. Display and Avatar are not required. Hardware support is distinct
from current availability; the server-selected capabilities control whether
microphone and playback adapters can run. A
device ID is not authentication. The server's trusted principal and device
authorization checks remain mandatory and fail closed. Enter a `wss://` URL
without embedded credentials in the app. No endpoint or credential is bundled.
The old Realtime development identity works only on a loopback-bound server
and is not phone admission. M2-C3 adds a distinct, explicit handshake-token
development path behind a trusted TLS reverse proxy. The iOS host accepts the
WSS endpoint and token at runtime; the token is not bundled or persisted and
never enters `device.hello`. Realtime still enforces M1-B device authorization.

The explicit push-to-talk path converts microphone input with AVAudioConverter,
encodes PCM16 little-endian in LYA1 binary frames, and sends `listen:start` /
audio / `listen:stop` only after v2 acceptance. Incoming LYA1 frames are
validated against the negotiated 24 kHz mono PCM16 format and played with
AVAudioPlayerNode. A network `tts:stop` means the stream ended; local playback
completion is based on `.dataPlayedBack` callbacks. Permission denial or a
missing route leaves Device Session admission possible without voice. A route
or interruption change closes the current session so a reconnect can truthfully
renegotiate availability.

When Start is pressed during TTS playback, the app immediately clears local
playback, sends `abort:user_cancel`, waits for the old `tts:stop`, then opens a
new `listen:start` turn. This is a temporary safe cancel/restart sequence, not
server-side barge-in. Reliable `abort:barge_in` and ended-input-queue reuse are
a separate server task; no v2 Device Session wire change is implied.

The checked-in `project.yml` defines the Xcode target. On macOS with
XcodeGen installed, run `xcodegen generate --spec apps/ios/project.yml`,
then build/test with Xcode. GitHub
Actions `ios` is the authoritative native compile and XCTest environment
while local development uses Ubuntu: `macos-15`, Xcode 16.4, iPhone 16
simulator on iOS 18.5, unsigned simulator build. The tests load the *same*
`packages/protocol/src/m2-wire-fixtures.json` resource as TypeScript tests.

Simulator compile/XCTest does not prove physical-device connectivity,
microphone capture/playback quality, live provider speech, WSS reachability,
or Apple signing. CI publishes a verified **unsigned**, device-targeted IPA
for external signing; it is not directly installable. The repository still has
no public WSS endpoint, production credentials, or signed iPhone build. Follow
the [first-phone operator procedure](../../docs/deployment/physical-iphone.md)
for TLS, token rotation, signing, and diagnostics.
