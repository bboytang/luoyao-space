import type { AudioPipeline } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type { DeviceCapabilityOffer } from "../../../packages/protocol/src/device-session";
import type {
  DeviceAuthorizationProvider,
  DeviceSessionOwnership,
  TrustedPrincipalProvider,
} from "../../device-runtime/src/session-boundary";
import type { RealtimeConfig } from "./config";
import { DeviceSessionAdmission, type DeviceSessionCapabilityDiagnostic } from "./device-session-admission";
import { RealtimeSessionService } from "./session-service";
import { WebSocketSessionConnection, type ServerWebSocketLike } from "./websocket-session-connection";

const serverCapabilities: readonly DeviceCapabilityOffer[] = [
  { id: "realtime.voice" },
  { id: "audio.input", formats: [{ codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1 }] },
  { id: "audio.output", formats: [{ codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1 }] },
];

export interface RealtimeAdmissionProviders<ConnectionContext> {
  principalProvider?: TrustedPrincipalProvider<ConnectionContext>;
  deviceAuthorizer?: DeviceAuthorizationProvider;
  onCapabilityNegotiationDiagnostic?: (diagnostic: DeviceSessionCapabilityDiagnostic) => void;
}

export function attachRealtimeConnection<ConnectionContext>(
  socket: ServerWebSocketLike,
  connectionContext: ConnectionContext,
  pipeline: AudioPipeline,
  config: RealtimeConfig,
  ownership: DeviceSessionOwnership,
  providers: RealtimeAdmissionProviders<ConnectionContext> = {},
): DeviceSessionAdmission | RealtimeSessionService {
  if (config.development.legacyV1) {
    return new RealtimeSessionService(new WebSocketSessionConnection(socket), pipeline);
  }

  const developmentIdentity = config.development.enabled ? config.development.identity : undefined;
  return new DeviceSessionAdmission(socket, pipeline, {
    resolvePrincipal: providers.principalProvider
      ? () => providers.principalProvider!.resolve(connectionContext)
      : developmentIdentity
        ? async () => ({ userId: developmentIdentity.userId })
        : undefined,
    authorizeDevice: providers.deviceAuthorizer
      ? (principal, deviceId) => providers.deviceAuthorizer!.findAuthorizedDevice(principal, deviceId)
      : developmentIdentity
        ? async (principal, deviceId) => principal.userId === developmentIdentity.userId &&
            deviceId === developmentIdentity.deviceId
          ? { userId: developmentIdentity.userId, deviceId: developmentIdentity.deviceId }
          : null
        : undefined,
    ownership,
    serverCapabilities,
    onCapabilityNegotiationDiagnostic: providers.onCapabilityNegotiationDiagnostic,
  });
}
