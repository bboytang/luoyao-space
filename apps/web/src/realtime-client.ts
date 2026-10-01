import type { RealtimeAudioInput, RealtimeAudioOutput } from "../../../runtimes/realtime-device/src/audio-io";
import type { AcceptedDeviceSessionV2, DeviceCapabilityOffer } from "../../../packages/protocol/src/device-session";
import { binaryAudioCodec } from "../../../runtimes/realtime-device/src/binary-audio-codec";
import { DeviceSessionClient, type DeviceSessionClientState } from "../../../runtimes/realtime-device/src/device-session-client";
import { WebSocketTransport, type WebSocketLike } from "../../../runtimes/realtime-device/src/websocket-transport";
import { RealtimeAvatarController } from "../../../runtimes/realtime-device/src/realtime-avatar-controller";
import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";

export interface RealtimeClientSocket extends WebSocketLike {
  waitForOpen(): Promise<void>;
}

export type RealtimeClientState = DeviceSessionClientState;

const pcmFormat = { codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1 } as const;

export interface RealtimeClientOptions {
  url: string;
  socket?: RealtimeClientSocket;
  avatar?: AvatarRuntime;
  input?: RealtimeAudioInput;
  output?: RealtimeAudioOutput;
  /** A stable declared identity. Authorization is verified by the server, never by this value. */
  deviceId: string;
  /** Results of Web adapter availability checks, not browser API presence. */
  availableAudio: { input: boolean; output: boolean };
  onStateChange?: (state: RealtimeClientState) => void;
}

export class BrowserWebSocket implements WebSocketLike {
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";
  }

  send(data: string | Uint8Array): void {
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  addEventListener(
    type: "message" | "close",
    listener:
      | ((event: { data: string | Uint8Array }) => void)
      | ((event: { code: number; reason: string; wasClean: boolean }) => void),
  ): void {
    if (type === "message") {
      this.socket.addEventListener("message", (event) => {
        const data = typeof event.data === "string"
          ? event.data
          : event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : event.data;
        (listener as (event: { data: string | Uint8Array }) => void)({ data });
      });
      return;
    }

    this.socket.addEventListener("close", (event) => {
      (listener as (event: { code: number; reason: string; wasClean: boolean }) => void)({
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
    });
  }

  waitForOpen(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), {
        once: true,
      });
      this.socket.addEventListener("close", () => reject(new Error("WebSocket closed before opening")), {
        once: true,
      });
    });
  }
}

export class RealtimeClient {
  private readonly session: DeviceSessionClient;
  private accepted?: AcceptedDeviceSessionV2;

  constructor(options: RealtimeClientOptions) {
    const socket = options.socket ?? new BrowserWebSocket(options.url);
    const transport = new WebSocketTransport(socket, binaryAudioCodec);
    const supportedCapabilities: DeviceCapabilityOffer[] = [];
    const availableCapabilities: DeviceCapabilityOffer[] = [];
    if (options.avatar) {
      supportedCapabilities.push({ id: "display" }, { id: "avatar.dynamic" });
      availableCapabilities.push({ id: "display" }, { id: "avatar.dynamic" });
    }
    if (options.input) {
      supportedCapabilities.push({ id: "audio.input", formats: [pcmFormat] });
      if (options.availableAudio.input) availableCapabilities.push({ id: "audio.input", formats: [pcmFormat] });
    }
    if (options.output) {
      supportedCapabilities.push({ id: "audio.output", formats: [pcmFormat] });
      if (options.availableAudio.output) availableCapabilities.push({ id: "audio.output", formats: [pcmFormat] });
    }
    if (options.input && options.output) {
      supportedCapabilities.push({ id: "realtime.voice" });
      if (options.availableAudio.input && options.availableAudio.output) {
        availableCapabilities.push({ id: "realtime.voice" });
      }
    }
    this.session = new DeviceSessionClient({
      transport,
      input: options.input,
      output: options.output,
      avatar: options.avatar ? new RealtimeAvatarController(options.avatar) : undefined,
      hello: {
        type: "device.hello", protocolVersions: [2],
        device: { deviceId: options.deviceId, platform: "web" },
        supportedCapabilities, availableCapabilities,
      },
      onStateChange: options.onStateChange,
    });
  }

  async connect(): Promise<AcceptedDeviceSessionV2> {
    const accepted = await this.session.connect();
    this.accepted = accepted;
    return accepted;
  }

  isOperational(): boolean { return this.session.getState() === "accepted"; }
  canUseAvatar(): boolean {
    return this.isOperational() && !!this.accepted?.negotiatedCapabilities.some((item) => item.id === "avatar.dynamic");
  }
  canUseVoice(): boolean {
    const ids = new Set<string>(this.accepted?.negotiatedCapabilities.map((item) => item.id));
    return this.isOperational() && ["realtime.voice", "audio.input", "audio.output"].every((id) => ids.has(id));
  }

  async startListening(): Promise<void> {
    await this.session.startListening();
  }

  async stopListening(): Promise<void> {
    await this.session.stopListening();
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  async interruptResponse(): Promise<void> {
    await this.session.interruptResponse();
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}
