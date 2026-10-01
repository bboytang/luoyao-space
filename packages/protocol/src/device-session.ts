export const DEVICE_SESSION_V2 = 2 as const;

export type DevicePlatform = "ios" | "windows" | "android" | "macos" | "iot" | "web";
export type DeviceCapabilityId =
  | "audio.input" | "audio.output" | "realtime.voice" | "display"
  | "avatar.dynamic" | "camera" | "notifications";
export type AudioFormat = { codec: "pcm_s16le" | "opus"; sampleRateHz: number; channels: number };
export type DeviceCapabilityOffer =
  | { id: "audio.input" | "audio.output"; formats: readonly AudioFormat[] }
  | { id: Exclude<DeviceCapabilityId, "audio.input" | "audio.output"> };
export type NegotiatedDeviceCapability =
  | { id: "audio.input" | "audio.output"; format: AudioFormat }
  | { id: Exclude<DeviceCapabilityId, "audio.input" | "audio.output"> };

export interface DeclaredDeviceIdentityV2 {
  deviceId: string;
  platform: DevicePlatform;
  label?: string;
}

export interface DeviceSessionHelloV2 {
  type: "device.hello";
  protocolVersions: readonly number[];
  device: DeclaredDeviceIdentityV2;
  supportedCapabilities: readonly DeviceCapabilityOffer[];
  availableCapabilities: readonly DeviceCapabilityOffer[];
}

export interface TrustedPrincipal { userId: string }
export interface AuthorizedDeviceIdentity { deviceId: string; userId: string }
export interface TransportSessionOwner {
  transportSessionId: string;
  connectionId: string;
  state: "active" | "ended";
}

export interface DeviceSessionNegotiationContext {
  principal?: TrustedPrincipal;
  authorizedDevice?: AuthorizedDeviceIdentity;
  transportSessionId: string;
  connectionId: string;
  activeOwner?: TransportSessionOwner;
  serverCapabilities: readonly DeviceCapabilityOffer[];
}

export interface AcceptedDeviceSessionV2 {
  type: "device.accepted";
  version: 2;
  transportSessionId: string;
  ownerConnectionId: string;
  negotiatedCapabilities: readonly NegotiatedDeviceCapability[];
}

// Server-side binding only. None of these trusted identities comes from client hello.
export interface BoundDeviceSessionV2 {
  principal: TrustedPrincipal;
  authorizedDevice: AuthorizedDeviceIdentity;
  declaredDevice: DeclaredDeviceIdentityV2;
  session: AcceptedDeviceSessionV2;
}

export type DeviceSessionRejectionReason =
  | "unsupported_version" | "invalid_hello" | "missing_negotiation_information"
  | "missing_trusted_identity" | "device_identity_mismatch" | "ownership_conflict"
  | "transport_session_ended";
export interface RejectedDeviceSessionV2 {
  type: "device.rejected";
  reason: DeviceSessionRejectionReason;
  supportedVersions: readonly [2];
}
export type DeviceSessionOutcomeV2 = AcceptedDeviceSessionV2 | RejectedDeviceSessionV2;

const platforms = new Set<DevicePlatform>(["ios", "windows", "android", "macos", "iot", "web"]);
const simpleCapabilities = new Set<DeviceCapabilityId>([
  "realtime.voice", "display", "avatar.dynamic", "camera", "notifications",
]);

export function isV2Platform(value: unknown): value is DevicePlatform {
  return typeof value === "string" && platforms.has(value as DevicePlatform);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAudioFormat(value: unknown): value is AudioFormat {
  return isRecord(value) && (value.codec === "pcm_s16le" || value.codec === "opus") &&
    Number.isInteger(value.sampleRateHz) && Number(value.sampleRateHz) > 0 &&
    Number.isInteger(value.channels) && Number(value.channels) > 0;
}

function formatKey(format: AudioFormat): string {
  return `${format.codec}:${format.sampleRateHz}:${format.channels}`;
}

function isCapabilityOffer(value: unknown): value is DeviceCapabilityOffer {
  if (!isRecord(value)) return false;
  if (value.id === "audio.input" || value.id === "audio.output") {
    return Array.isArray(value.formats) && value.formats.length > 0 &&
      value.formats.every(isAudioFormat) &&
      new Set((value.formats as AudioFormat[]).map(formatKey)).size === value.formats.length;
  }
  return simpleCapabilities.has(value.id as DeviceCapabilityId) && value.formats === undefined;
}

function isCapabilityList(value: unknown): value is DeviceCapabilityOffer[] {
  return Array.isArray(value) && value.every(isCapabilityOffer) &&
    new Set(value.map((capability: DeviceCapabilityOffer) => capability.id)).size === value.length;
}

function hasMissingAudioFormats(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => isRecord(entry) &&
    (entry.id === "audio.input" || entry.id === "audio.output") &&
    (!Array.isArray(entry.formats) || entry.formats.length === 0));
}

function isAvailableSubset(supported: readonly DeviceCapabilityOffer[], available: readonly DeviceCapabilityOffer[]): boolean {
  return available.every((capability) => {
    const support = supported.find((entry) => entry.id === capability.id);
    if (!support) return false;
    if ("formats" in capability && "formats" in support) {
      const formats = new Set(support.formats.map(formatKey));
      return capability.formats.every((format) => formats.has(formatKey(format)));
    }
    return !("formats" in capability) && !("formats" in support);
  });
}

function reject(reason: DeviceSessionRejectionReason): RejectedDeviceSessionV2 {
  return { type: "device.rejected", reason, supportedVersions: [DEVICE_SESSION_V2] };
}

/** Pure v2 selection; the caller must authenticate and authorize before supplying context. */
export function negotiateDeviceSession(hello: unknown, context: DeviceSessionNegotiationContext): DeviceSessionOutcomeV2 {
  if (!isRecord(hello) || hello.type !== "device.hello") return reject("invalid_hello");
  if (!Array.isArray(hello.protocolVersions) || hello.protocolVersions.length === 0 ||
      !isRecord(hello.device) || !nonEmpty(hello.device.deviceId) ||
      !Array.isArray(hello.supportedCapabilities) || !Array.isArray(hello.availableCapabilities)) {
    return reject("missing_negotiation_information");
  }
  if (!hello.protocolVersions.every((version) => Number.isInteger(version) && version > 0)) {
    return reject("invalid_hello");
  }
  if (!hello.protocolVersions.includes(DEVICE_SESSION_V2)) return reject("unsupported_version");
  if (hasMissingAudioFormats(hello.supportedCapabilities) ||
      hasMissingAudioFormats(hello.availableCapabilities) ||
      hasMissingAudioFormats(context.serverCapabilities)) {
    return reject("missing_negotiation_information");
  }
  if (!isV2Platform(hello.device.platform) ||
      (hello.device.label !== undefined && !nonEmpty(hello.device.label)) ||
      !isCapabilityList(hello.supportedCapabilities) || !isCapabilityList(hello.availableCapabilities)) {
    return reject("invalid_hello");
  }
  if (!isAvailableSubset(hello.supportedCapabilities, hello.availableCapabilities)) {
    return reject("invalid_hello");
  }
  if (!context.principal || !nonEmpty(context.principal.userId) ||
      !context.authorizedDevice || !nonEmpty(context.authorizedDevice.deviceId) ||
      !nonEmpty(context.authorizedDevice.userId)) {
    return reject("missing_trusted_identity");
  }
  if (context.principal.userId !== context.authorizedDevice.userId ||
      context.authorizedDevice.deviceId !== hello.device.deviceId) {
    return reject("device_identity_mismatch");
  }
  if (!nonEmpty(context.transportSessionId) || !nonEmpty(context.connectionId) ||
      !isCapabilityList(context.serverCapabilities)) {
    return reject("missing_negotiation_information");
  }
  if (context.activeOwner?.transportSessionId === context.transportSessionId) {
    if (context.activeOwner.state === "ended") return reject("transport_session_ended");
    if (context.activeOwner.connectionId !== context.connectionId) return reject("ownership_conflict");
  }

  const negotiatedCapabilities: NegotiatedDeviceCapability[] = [];
  for (const server of context.serverCapabilities) {
    const available = hello.availableCapabilities.find((capability) => capability.id === server.id);
    if (!available) continue;
    if ("formats" in server && "formats" in available) {
      const availableFormats = new Set(available.formats.map(formatKey));
      const format = server.formats.find((candidate) => availableFormats.has(formatKey(candidate)));
      if (format) negotiatedCapabilities.push({ id: server.id, format });
    } else if (!("formats" in server) && !("formats" in available)) {
      negotiatedCapabilities.push({ id: server.id });
    }
  }
  return {
    type: "device.accepted", version: DEVICE_SESSION_V2,
    transportSessionId: context.transportSessionId,
    ownerConnectionId: context.connectionId,
    negotiatedCapabilities,
  };
}
