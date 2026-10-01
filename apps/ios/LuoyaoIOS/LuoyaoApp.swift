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
        }
    }
}
