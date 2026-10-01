import { describe, expect, it, vi } from "vitest";
import type { AudioPipeline } from "../../../runtimes/realtime-device/src/audio-pipeline";
import type { DeviceCapabilityOffer, DeviceSessionHelloV2 } from "../../../packages/protocol/src/device-session";
import { binaryAudioCodec } from "../../../runtimes/realtime-device/src/binary-audio-codec";
import { InMemoryDeviceSessionOwnership } from "../../device-runtime/src/session-boundary";
import type { ServerWebSocketLike } from "./websocket-session-connection";
import { DeviceSessionAdmission } from "./device-session-admission";

class FakeSocket implements ServerWebSocketLike {
  readonly sent: Array<string | Uint8Array> = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private readonly messages: Array<(event: { data: string | Uint8Array | ArrayBuffer }) => void | Promise<void>> = [];
  private readonly closeHandlers: Array<() => void> = [];
  send(data: string | Uint8Array): void { this.sent.push(data); }
  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.disconnect();
  }
  disconnect(): void { for (const handler of this.closeHandlers) handler(); }
  addEventListener(type: "message" | "close", listener: ((event: { data: string | Uint8Array | ArrayBuffer }) => void | Promise<void>) | (() => void)): void {
    if (type === "message") this.messages.push(listener as (event: { data: string | Uint8Array | ArrayBuffer }) => void | Promise<void>);
    else this.closeHandlers.push(listener as () => void);
  }
  async receive(data: string | Uint8Array): Promise<void> {
    await Promise.all(this.messages.map((handler) => handler({ data })));
  }
  controls(): Record<string, unknown>[] {
    return this.sent.filter((item): item is string => typeof item === "string").map((item) => JSON.parse(item) as Record<string, unknown>);
  }
}

const pcm = { codec: "pcm_s16le" as const, sampleRateHz: 24_000, channels: 1 };
const voiceCapabilities: DeviceCapabilityOffer[] = [
  { id: "realtime.voice" },
  { id: "audio.input", formats: [pcm] },
  { id: "audio.output", formats: [pcm] },
];

function hello(overrides: Partial<DeviceSessionHelloV2> = {}): DeviceSessionHelloV2 {
  return {
    type: "device.hello", protocolVersions: [2],
    device: { deviceId: "device-1", platform: "iot" },
    supportedCapabilities: [], availableCapabilities: [], ...overrides,
  };
}

function createHarness(options: {
  principal?: { userId: string } | null;
  authorizedDeviceId?: string | null;
  serverCapabilities?: DeviceCapabilityOffer[];
  ownership?: InMemoryDeviceSessionOwnership;
  transportSessionId?: string;
  connectionId?: string;
} = {}) {
  const socket = new FakeSocket();
  const ownership = options.ownership ?? new InMemoryDeviceSessionOwnership();
  const receivedFrames = vi.fn();
  const pipeline: AudioPipeline = {
    vad: { detect: async () => ({ speech: false, startOfSpeech: false, endOfSpeech: false }) },
    asr: { async *transcribe(frames) {
      for await (const frame of frames) {
        receivedFrames(frame);
        return;
      }
    } },
    llm: { async *stream() {} },
    tts: { async *synthesize() {} },
  };
  const authorization = vi.fn(async (_principal: { userId: string }, deviceId: string) =>
    deviceId === (options.authorizedDeviceId === undefined ? "device-1" : options.authorizedDeviceId)
      ? { userId: "user-1", deviceId } : null);
  new DeviceSessionAdmission(socket, pipeline, {
    resolvePrincipal: async () => options.principal === undefined ? { userId: "user-1" } : options.principal,
    authorizeDevice: authorization,
    ownership,
    serverCapabilities: options.serverCapabilities ?? [],
    createTransportSessionId: () => options.transportSessionId ?? "transport-1",
    createConnectionId: () => options.connectionId ?? "connection-1",
    createConversationId: () => "conversation-1",
  });
  return { socket, ownership, receivedFrames, authorization, pipeline };
}

describe("v2 realtime device admission", () => {
  it("accepts a trusted principal and authorized device without requiring screen, avatar or audio", async () => {
    const { socket, ownership } = createHarness();
    await socket.receive(JSON.stringify(hello()));
    expect(socket.controls()).toEqual([{
      type: "device.accepted", version: 2, transportSessionId: "transport-1",
      ownerConnectionId: "connection-1", negotiatedCapabilities: [],
    }]);
    expect(ownership.get("transport-1")?.state).toBe("active");
  });

  it("rejects an unauthorized or fake device without acquiring ownership", async () => {
    const { socket, ownership } = createHarness();
    await socket.receive(JSON.stringify(hello({ device: { deviceId: "fake", platform: "ios" } })));
    expect(socket.controls()[0]).toMatchObject({ type: "device.rejected", reason: "device_identity_mismatch" });
    expect(socket.closes).toHaveLength(1);
    expect(ownership.get("transport-1")).toBeUndefined();
  });

  it("fails closed without a trusted principal, regardless of declared capability", async () => {
    const { socket, ownership, authorization } = createHarness({ principal: null, serverCapabilities: voiceCapabilities });
    await socket.receive(JSON.stringify(hello({
      supportedCapabilities: voiceCapabilities, availableCapabilities: voiceCapabilities,
    })));
    expect(socket.controls()[0]).toMatchObject({ type: "device.rejected", reason: "missing_trusted_identity" });
    expect(authorization).not.toHaveBeenCalled();
    expect(ownership.get("transport-1")).toBeUndefined();
  });

  it("rejects and closes when the trusted-principal provider throws synchronously", async () => {
    const socket = new FakeSocket();
    const ownership = new InMemoryDeviceSessionOwnership();
    new DeviceSessionAdmission(socket, createHarness().pipeline, {
      resolvePrincipal: () => { throw new Error("identity provider unavailable"); },
      authorizeDevice: async () => ({ userId: "user-1", deviceId: "device-1" }),
      ownership,
      serverCapabilities: [],
      createTransportSessionId: () => "transport-1",
    });
    await socket.receive(JSON.stringify(hello()));
    expect(socket.controls()[0]).toMatchObject({ type: "device.rejected", reason: "missing_trusted_identity" });
    expect(socket.closes).toHaveLength(1);
    expect(ownership.get("transport-1")).toBeUndefined();
  });

  it("rejects incompatible versions with a machine-readable response", async () => {
    const { socket } = createHarness();
    await socket.receive(JSON.stringify(hello({ protocolVersions: [3] })));
    expect(socket.controls()[0]).toEqual({
      type: "device.rejected", reason: "unsupported_version", supportedVersions: [2],
    });
    expect(socket.closes).toHaveLength(1);
  });

  it("rejects missing negotiation data and does not start media", async () => {
    const { socket, receivedFrames, ownership } = createHarness();
    await socket.receive(JSON.stringify({ ...hello(), availableCapabilities: undefined }));
    expect(socket.controls()[0]).toMatchObject({ type: "device.rejected", reason: "missing_negotiation_information" });
    expect(receivedFrames).not.toHaveBeenCalled();
    expect(ownership.get("transport-1")).toBeUndefined();
  });

  it("does not negotiate a supported capability that is currently unavailable", async () => {
    const { socket } = createHarness({ serverCapabilities: voiceCapabilities });
    await socket.receive(JSON.stringify(hello({
      supportedCapabilities: voiceCapabilities, availableCapabilities: [{ id: "realtime.voice" }],
    })));
    expect(socket.controls()[0]).toMatchObject({
      type: "device.accepted", negotiatedCapabilities: [{ id: "realtime.voice" }],
    });
  });

  it("rejects a second connection for the same active session and preserves the first owner", async () => {
    const ownership = new InMemoryDeviceSessionOwnership();
    const first = createHarness({ ownership, connectionId: "connection-1" });
    const second = createHarness({ ownership, connectionId: "connection-2" });
    await first.socket.receive(JSON.stringify(hello()));
    await second.socket.receive(JSON.stringify(hello()));
    expect(second.socket.controls()[0]).toMatchObject({ type: "device.rejected", reason: "ownership_conflict" });
    expect(ownership.get("transport-1")?.connectionId).toBe("connection-1");
  });

  it("ends ownership on disconnect and requires a new transport session on the next connection", async () => {
    const ownership = new InMemoryDeviceSessionOwnership();
    const first = createHarness({ ownership });
    await first.socket.receive(JSON.stringify(hello()));
    first.socket.disconnect();
    expect(ownership.get("transport-1")?.state).toBe("ended");
    const oldId = createHarness({ ownership, connectionId: "connection-2" });
    await oldId.socket.receive(JSON.stringify(hello()));
    expect(oldId.socket.controls()[0]).toMatchObject({ type: "device.rejected", reason: "transport_session_ended" });
    const next = createHarness({ ownership, connectionId: "connection-3", transportSessionId: "transport-2" });
    await next.socket.receive(JSON.stringify(hello()));
    expect(next.socket.controls()[0]).toMatchObject({ type: "device.accepted", transportSessionId: "transport-2" });
  });

  it("rejects media before acceptance without starting the audio pipeline", async () => {
    const { socket, receivedFrames, ownership } = createHarness();
    await socket.receive(binaryAudioCodec.encodeAudio({
      kind: "audio", codec: "pcm_s16le", sampleRate: 24_000, channels: 1,
      sequence: 0, payload: new Uint8Array([0, 1]),
    }));
    expect(socket.controls()[0]).toMatchObject({ type: "device.rejected" });
    expect(receivedFrames).not.toHaveBeenCalled();
    expect(ownership.get("transport-1")).toBeUndefined();
  });

  it("starts voice processing only after v2 acceptance and a negotiated voice capability", async () => {
    const { socket, receivedFrames } = createHarness({ serverCapabilities: voiceCapabilities });
    await socket.receive(JSON.stringify(hello({
      supportedCapabilities: voiceCapabilities, availableCapabilities: voiceCapabilities,
    })));
    await socket.receive(JSON.stringify({ type: "listen", mode: "start", conversationId: "client-forged" }));
    await socket.receive(binaryAudioCodec.encodeAudio({
      kind: "audio", codec: "pcm_s16le", sampleRate: 24_000, channels: 1,
      sequence: 0, payload: new Uint8Array([0, 1]),
    }));
    await vi.waitFor(() => expect(receivedFrames).toHaveBeenCalled());
    expect(socket.controls()[0]).toMatchObject({ type: "device.accepted" });
  });
});
