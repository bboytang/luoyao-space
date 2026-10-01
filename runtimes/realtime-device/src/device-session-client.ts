import type {
  AcceptedDeviceSessionV2,
  AudioFormat,
  DeviceSessionHelloV2,
  DeviceSessionRejectionReason,
  NegotiatedDeviceCapability,
} from "../../../packages/protocol/src/device-session";
import type { DeviceSessionTransport } from "./transport";
import type { RealtimeAudioInput, RealtimeAudioOutput } from "./audio-io";
import { RealtimeSession, type RealtimeAvatarControllerPort } from "./realtime-session";

export type DeviceSessionClientState =
  | "disconnected" | "transport_connecting" | "awaiting_admission"
  | "accepted" | "rejected" | "terminated";

export class DeviceSessionRejectedError extends Error {
  constructor(public readonly reason: DeviceSessionRejectionReason, public readonly supportedVersions: readonly number[]) {
    super(`Device session rejected: ${reason}`);
    this.name = "DeviceSessionRejectedError";
  }
}

export interface DeviceSessionClientOptions {
  transport: DeviceSessionTransport;
  hello: DeviceSessionHelloV2;
  input?: RealtimeAudioInput;
  output?: RealtimeAudioOutput;
  avatar?: RealtimeAvatarControllerPort;
  onStateChange?: (state: DeviceSessionClientState) => void;
}

export class DeviceSessionClient {
  private state: DeviceSessionClientState = "disconnected";
  private connectPromise?: Promise<AcceptedDeviceSessionV2>;
  private pending?: { resolve: (accepted: AcceptedDeviceSessionV2) => void; reject: (error: Error) => void };
  private removeAdmission: () => void;
  private removeClose: () => void;
  private voice?: RealtimeSession;
  private admissionInProgress = false;

  constructor(private readonly options: DeviceSessionClientOptions) {
    this.removeAdmission = options.transport.onDeviceSession(async (outcome) => {
      if (this.state !== "awaiting_admission" || !this.pending || this.admissionInProgress) return;
      this.admissionInProgress = true;
      if (outcome.type === "device.rejected") {
        this.setState("rejected");
        this.pending.reject(new DeviceSessionRejectedError(outcome.reason, outcome.supportedVersions));
        this.pending = undefined;
        void options.transport.close(1000, "device admission rejected").catch(() => {});
        return;
      }
      if (!this.validAcceptance(outcome)) {
        this.fail(new Error("Invalid or unoffered accepted device capability"));
        return;
      }
      const negotiated = outcome.negotiatedCapabilities;
      const input = negotiated.find((capability) => capability.id === "audio.input");
      const output = negotiated.find((capability) => capability.id === "audio.output");
      if (negotiated.some((capability) => capability.id === "realtime.voice") &&
          input && "format" in input && output && "format" in output) {
        if (!options.input || !options.output) {
          this.fail(new Error("Negotiated voice requires available audio adapters"));
          return;
        }
        const avatar = negotiated.some((capability) => capability.id === "avatar.dynamic")
          ? options.avatar ?? inactiveAvatar
          : inactiveAvatar;
        const selectedInput = input.format;
        const selectedOutput = output.format;
        const gatedInput: RealtimeAudioInput = {
          start: (onFrame) => options.input!.start((frame) => {
            if (matchesAudioFormat(frame, selectedInput)) onFrame(frame);
          }),
          stop: () => options.input!.stop(),
        };
        const gatedOutput: RealtimeAudioOutput = {
          play: (frame) => matchesAudioFormat(frame, selectedOutput)
            ? options.output!.play(frame) : Promise.resolve(),
          waitForIdle: options.output.waitForIdle
            ? () => options.output!.waitForIdle!() : undefined,
          stop: () => options.output!.stop(),
        };
        this.voice = new RealtimeSession({
          transport: options.transport, input: gatedInput, output: gatedOutput,
          avatar, sessionId: outcome.transportSessionId, admitted: true,
          acceptOutputFrame: (frame) => matchesAudioFormat(frame, selectedOutput),
        });
        try {
          await this.voice.connect();
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
      if (this.state !== "awaiting_admission" || !this.pending) return;
      this.setState("accepted");
      this.pending.resolve(outcome);
      this.pending = undefined;
    });
    this.removeClose = options.transport.onClose(() => {
      if (this.state === "rejected" || this.state === "terminated") return;
      this.setState("terminated");
      this.pending?.reject(new Error("Device session transport closed"));
      this.pending = undefined;
      void this.voice?.close().catch(() => {});
    });
  }

  getState(): DeviceSessionClientState { return this.state; }

  async startListening(): Promise<void> {
    if (this.state !== "accepted") throw new Error("Device session is not accepted");
    if (!this.voice) throw new Error("Realtime voice was not negotiated");
    await this.voice.startListening();
  }

  async stopListening(): Promise<void> {
    if (this.state !== "accepted") throw new Error("Device session is not accepted");
    if (!this.voice) throw new Error("Realtime voice was not negotiated");
    await this.voice.stopListening();
  }

  async abort(): Promise<void> {
    if (this.state !== "accepted") throw new Error("Device session is not accepted");
    if (!this.voice) throw new Error("Realtime voice was not negotiated");
    await this.voice.abort();
  }

  async interruptResponse(): Promise<void> {
    if (this.state !== "accepted") throw new Error("Device session is not accepted");
    if (!this.voice) throw new Error("Realtime voice was not negotiated");
    await this.voice.interruptResponse();
  }

  connect(): Promise<AcceptedDeviceSessionV2> {
    if (this.state === "terminated" || this.state === "rejected") {
      return Promise.reject(new Error("Device session is terminated; create a new client to reconnect"));
    }
    if (this.connectPromise) return this.connectPromise;
    this.setState("transport_connecting");
    this.connectPromise = new Promise<AcceptedDeviceSessionV2>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
    void (async () => {
      try {
        await this.options.transport.waitUntilReady();
        if (this.state !== "transport_connecting") return;
        this.setState("awaiting_admission");
        await this.options.transport.sendDeviceHello(this.options.hello);
      } catch (error) {
        this.setState("terminated");
        this.pending?.reject(error instanceof Error ? error : new Error(String(error)));
        this.pending = undefined;
      }
    })();
    return this.connectPromise;
  }

  async close(): Promise<void> {
    if (this.state === "terminated") return;
    this.setState("terminated");
    this.pending?.reject(new Error("Device session closed"));
    this.pending = undefined;
    this.removeAdmission();
    this.removeClose();
    if (this.voice) await this.voice.close();
    else await this.options.transport.close(1000, "device session closed");
  }

  private validAcceptance(outcome: AcceptedDeviceSessionV2): boolean {
    if (outcome.version !== 2 || typeof outcome.transportSessionId !== "string" ||
        !outcome.transportSessionId.trim() || typeof outcome.ownerConnectionId !== "string" ||
        !outcome.ownerConnectionId.trim() ||
        !Array.isArray(outcome.negotiatedCapabilities)) return false;
    const available = this.options.hello.availableCapabilities;
    const ids = new Set<string>();
    return outcome.negotiatedCapabilities.every((capability: NegotiatedDeviceCapability) => {
      if (!capability || typeof capability !== "object" || typeof capability.id !== "string") return false;
      if (ids.has(capability.id)) return false;
      ids.add(capability.id);
      const offer = available.find((candidate) => candidate.id === capability.id);
      if (!offer) return false;
      if ("format" in capability) {
        return capability.format !== null && typeof capability.format === "object" &&
          "formats" in offer && offer.formats.some((format) =>
          format.codec === capability.format.codec &&
          format.sampleRateHz === capability.format.sampleRateHz &&
          format.channels === capability.format.channels);
      }
      return !("formats" in offer);
    });
  }

  private fail(error: Error): void {
    if (this.state === "terminated" || this.state === "rejected") return;
    this.setState("terminated");
    this.pending?.reject(error);
    this.pending = undefined;
    void this.options.transport.close(1002, "invalid device admission").catch(() => {});
  }

  private setState(state: DeviceSessionClientState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

const inactiveAvatar: RealtimeAvatarControllerPort = {
  handleServerMessage() {}, handleAudioFrame() {}, getPlaybackEpoch: () => 0,
  handlePlaybackIdle() {}, handleAborted() {}, handleClosed() {},
};

function matchesAudioFormat(frame: import("./protocol").AudioFrame, format: AudioFormat): boolean {
  return frame.codec === format.codec && frame.sampleRate === format.sampleRateHz &&
    frame.channels === format.channels;
}
