import type { AudioPipeline } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type {
  AuthorizedDeviceIdentity,
  AudioFormat,
  DeviceCapabilityOffer,
  DeviceSessionRejectionReason,
  RejectedDeviceSessionV2,
  TrustedPrincipal,
} from "../../../packages/protocol/src/device-session";
import { negotiateDeviceSession } from "../../../packages/protocol/src/device-session";
import type { AudioFrame, RealtimeControlMessage, RealtimeServerMessage } from "../../../runtimes/realtime-device/src/protocol";
import { isControlMessage } from "../../../runtimes/realtime-device/src/protocol";
import { binaryAudioCodec } from "../../../runtimes/realtime-device/src/binary-audio-codec";
import type { DeviceSessionOwnership } from "../../device-runtime/src/session-boundary";
import type { ServerWebSocketLike } from "./websocket-session-connection";
import { RealtimeSessionService, type RealtimeSessionConnection } from "./session-service";

export interface DeviceSessionAdmissionOptions {
  resolvePrincipal?: () => Promise<TrustedPrincipal | null>;
  authorizeDevice?: (principal: TrustedPrincipal, deviceId: string) => Promise<AuthorizedDeviceIdentity | null>;
  ownership: DeviceSessionOwnership;
  serverCapabilities: readonly DeviceCapabilityOffer[];
  createTransportSessionId?: () => string;
  createConnectionId?: () => string;
  createConversationId?: () => string;
}

export class DeviceSessionAdmission implements RealtimeSessionConnection {
  private readonly controlHandlers = new Set<(message: RealtimeControlMessage) => void | Promise<void>>();
  private readonly audioHandlers = new Set<(frame: AudioFrame) => void | Promise<void>>();
  private readonly closeHandlers = new Set<() => void | Promise<void>>();
  private readonly connectionId: string;
  private readonly transportSessionId: string;
  private readonly conversationId: string;
  private readonly principalPromise: Promise<TrustedPrincipal | null>;
  private controlTail: Promise<void> = Promise.resolve();
  private inputFormat?: AudioFormat;
  private accepted = false;
  private owned = false;
  private closed = false;

  constructor(
    private readonly socket: ServerWebSocketLike,
    private readonly pipeline: AudioPipeline,
    private readonly options: DeviceSessionAdmissionOptions,
  ) {
    this.connectionId = options.createConnectionId?.() ?? crypto.randomUUID();
    this.transportSessionId = options.createTransportSessionId?.() ?? crypto.randomUUID();
    this.conversationId = options.createConversationId?.() ?? crypto.randomUUID();
    this.principalPromise = Promise.resolve()
      .then(() => options.resolvePrincipal?.() ?? null)
      .catch(() => null);
    socket.addEventListener("message", (event) => this.receive(event.data));
    socket.addEventListener("close", () => this.handleClose());
  }

  async send(message: RealtimeServerMessage): Promise<void> {
    if (!this.closed) this.socket.send(JSON.stringify(message));
  }

  async sendAudio(frame: AudioFrame): Promise<void> {
    if (!this.closed) this.socket.send(binaryAudioCodec.encodeAudio(frame));
  }

  onControl(handler: (message: RealtimeControlMessage) => void | Promise<void>): () => void {
    this.controlHandlers.add(handler);
    return () => this.controlHandlers.delete(handler);
  }

  onAudio(handler: (frame: AudioFrame) => void | Promise<void>): () => void {
    this.audioHandlers.add(handler);
    return () => this.audioHandlers.delete(handler);
  }

  onClose(handler: () => void | Promise<void>): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  private receive(data: string | Uint8Array | ArrayBuffer): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (typeof data !== "string") return this.receiveAudio(data);
    const operation = this.controlTail.then(() => this.receiveControl(data));
    this.controlTail = operation.catch(() => this.reject("invalid_hello"));
    return this.controlTail;
  }

  private async receiveControl(data: string): Promise<void> {
    if (this.closed) return;
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      this.reject("invalid_hello");
      return;
    }
    if (!this.accepted) {
      await this.admit(value);
      return;
    }
    if (!isControlMessage(value) || value.type === "hello") {
      this.socket.close(1002, "Invalid post-admission control message");
      return;
    }
    if (!this.inputFormat) {
      if (value.type === "ping") await this.send({ type: "pong", timestamp: value.timestamp });
      else await this.send({ type: "error", code: "voice_not_negotiated", message: "Realtime voice was not negotiated", retryable: false });
      return;
    }
    const control = value.type === "listen"
      ? { ...value, conversationId: this.conversationId }
      : value;
    for (const handler of this.controlHandlers) await handler(control);
  }

  private async admit(value: unknown): Promise<void> {
    const principal = await this.principalPromise;
    if (this.closed) return;
    if (!principal || !this.options.authorizeDevice) {
      this.reject("missing_trusted_identity");
      return;
    }
    const deviceId = typeof value === "object" && value !== null && "device" in value &&
      typeof value.device === "object" && value.device !== null && "deviceId" in value.device &&
      typeof value.device.deviceId === "string" ? value.device.deviceId : undefined;
    if (!deviceId) {
      this.reject("missing_negotiation_information");
      return;
    }
    let authorizedDevice: AuthorizedDeviceIdentity | null;
    try {
      authorizedDevice = await this.options.authorizeDevice(principal, deviceId);
    } catch {
      authorizedDevice = null;
    }
    if (this.closed) return;
    if (!authorizedDevice) {
      this.reject("device_identity_mismatch");
      return;
    }
    const decision = negotiateDeviceSession(value, {
      principal,
      authorizedDevice,
      transportSessionId: this.transportSessionId,
      connectionId: this.connectionId,
      serverCapabilities: this.options.serverCapabilities,
    });
    if (decision.type === "device.rejected") {
      this.reject(decision.reason);
      return;
    }
    const claim = this.options.ownership.acquire(this.transportSessionId, this.connectionId);
    if (claim !== "acquired") {
      this.reject(claim);
      return;
    }
    this.owned = true;
    if (this.closed) {
      this.release();
      return;
    }
    try {
      this.socket.send(JSON.stringify(decision));
    } catch {
      this.socket.close(1011, "Admission response failed");
      this.release();
      return;
    }
    if (this.closed) {
      this.release();
      return;
    }
    this.accepted = true;
    const negotiated = decision.negotiatedCapabilities;
    const input = negotiated.find((capability) => capability.id === "audio.input");
    const output = negotiated.find((capability) => capability.id === "audio.output");
    if (negotiated.some((capability) => capability.id === "realtime.voice") &&
        input && "format" in input && output && "format" in output) {
      this.inputFormat = input.format;
      new RealtimeSessionService(this, this.pipeline, { admittedSessionId: this.transportSessionId });
    }
  }

  private async receiveAudio(data: Uint8Array | ArrayBuffer): Promise<void> {
    if (!this.accepted) {
      this.reject("invalid_hello");
      return;
    }
    if (!this.inputFormat) {
      await this.send({ type: "error", code: "voice_not_negotiated", message: "Realtime voice was not negotiated", retryable: false });
      this.socket.close(1002, "Voice not negotiated");
      return;
    }
    let frame: AudioFrame;
    try {
      frame = binaryAudioCodec.decodeAudio(data instanceof Uint8Array ? data : new Uint8Array(data));
    } catch {
      this.socket.close(1002, "Invalid audio frame");
      return;
    }
    if (frame.codec !== this.inputFormat.codec || frame.sampleRate !== this.inputFormat.sampleRateHz ||
        frame.channels !== this.inputFormat.channels) {
      this.socket.close(1002, "Unnegotiated audio format");
      return;
    }
    for (const handler of this.audioHandlers) await handler(frame);
  }

  private reject(reason: DeviceSessionRejectionReason): void {
    if (this.closed) return;
    const rejection: RejectedDeviceSessionV2 = {
      type: "device.rejected", reason, supportedVersions: [2],
    };
    try {
      this.socket.send(JSON.stringify(rejection));
    } finally {
      this.socket.close(1008, "Device session rejected");
      this.handleClose();
    }
  }

  private release(): void {
    if (!this.owned) return;
    this.owned = false;
    this.options.ownership.release(this.transportSessionId, this.connectionId);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.release();
    for (const handler of this.closeHandlers) void handler();
  }
}
