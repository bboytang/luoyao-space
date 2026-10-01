# Native iOS Device Session host (M2-C1)

This is Luoyao's first native host: SwiftUI for the minimal diagnostic UI and
Foundation `URLSessionWebSocketTask` for WSS. It independently implements the
platform-neutral Device Session v2 wire contract; it does not embed Web, the
TypeScript runtime, Brain, Avatar, or audio hardware. Web remains a
reference/debug/integration host, not an iOS UI template.

The app targets iOS 17.0 or newer. It stores a stable *declared* device ID in
UserDefaults and currently offers no audio/display/Avatar capabilities. A
device ID is not authentication. The server's trusted principal and device
authorization checks remain mandatory and fail closed. Enter a `wss://` URL
without embedded credentials in the app. No endpoint or credential is bundled.
The current Realtime development identity works only on a loopback-bound
server; exposing it as a public-phone admission method is not approved.

The checked-in `project.yml` defines the Xcode target. On macOS with
XcodeGen installed, run `xcodegen generate --spec apps/ios/project.yml`,
then build/test with Xcode. GitHub
Actions `ios` is the authoritative native compile and XCTest environment
while local development uses Ubuntu: `macos-15`, Xcode 16.4, iPhone 16
simulator on iOS 18.5, unsigned simulator build. The tests load the *same*
`packages/protocol/src/m2-wire-fixtures.json` resource as TypeScript tests.

Simulator compile/contract testing does not prove physical-device connectivity,
microphone capture, playback, WSS reachability, or Apple signing. Those are
separate later milestones; M2-C1 requires no Apple signing credentials.
