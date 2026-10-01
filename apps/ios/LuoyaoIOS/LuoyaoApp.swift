import SwiftUI

@main struct LuoyaoApp: App {
    var body: some Scene {
        WindowGroup { DeviceSessionView() }
    }
}

private struct DeviceSessionView: View {
    @StateObject private var client = NativeDeviceSessionClient()
    @State private var endpoint = ""

    var body: some View {
        Form {
            Section("Device Session v2") {
                Text("State: \(client.state.rawValue)")
                Text(client.diagnostic)
                if let reason = client.rejectionReason { Text("Rejection: \(reason)") }
                if let session = client.sessionID { Text("Session: \(session)") }
            }
            Section("Development connection") {
                TextField("wss://host/realtime", text: $endpoint)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button("Connect") { client.connect(endpoint: endpoint) }
                Button("Disconnect") { client.disconnect() }
                Text("Device ID: \(client.deviceId)")
                    .font(.footnote)
                Text("Device ID is not authentication. Server admission remains fail-closed.")
                    .font(.footnote)
            }
            Section("Native voice · push to talk") {
                Text(client.microphoneStatus)
                Button("Allow microphone") { Task { await client.requestMicrophonePermission() } }
                Button("Start speaking") { Task { await client.startListening() } }
                    .disabled(client.state != .accepted || !client.canListen)
                Button("Stop speaking") { Task { await client.stopListening() } }
                    .disabled(client.state != .accepted || !client.canListen)
                Button("Cancel turn") { Task { await client.cancelTurn() } }
                    .disabled(client.state != .accepted)
                Text(client.voiceStatus)
                if !client.transcript.isEmpty { Text("Heard: \(client.transcript)") }
                Text(client.canPlay ? "Native playback negotiated" : "Native playback not negotiated")
                    .font(.footnote)
                Text("During playback, Start stops local sound, cancels the old turn, waits for its end, then opens a new turn. This is not server-side barge-in.")
                    .font(.footnote)
            }
        }
    }
}
