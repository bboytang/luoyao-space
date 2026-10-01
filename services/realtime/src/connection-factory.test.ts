import { describe, expect, it } from "vitest";
import type { AudioPipeline } from "../../../runtimes/realtime-device/src/audio-pipeline";
import { InMemoryDeviceSessionOwnership } from "../../device-runtime/src/session-boundary";
import { loadRealtimeConfig } from "./config";
import type { ServerWebSocketLike } from "./websocket-session-connection";
import { attachRealtimeConnection } from "./connection-factory";

class FakeSocket implements ServerWebSocketLike {
  readonly sent: string[] = [];
  readonly closes: number[] = [];
  private messages: Array<(event: { data: string | Uint8Array | ArrayBuffer }) => void | Promise<void>> = [];
  private closeHandlers: Array<() => void> = [];
  send(data: string | Uint8Array): void { if (typeof data === "string") this.sent.push(data); }
  close(code?: number): void { this.closes.push(code ?? 1000); for (const handler of this.closeHandlers) handler(); }
  addEventListener(type: "message" | "close", listener: ((event: { data: string | Uint8Array | ArrayBuffer }) => void | Promise<void>) | (() => void)): void {
    if (type === "message") this.messages.push(listener as (event: { data: string | Uint8Array | ArrayBuffer }) => void | Promise<void>);
    else this.closeHandlers.push(listener as () => void);
  }
  async receive(value: unknown): Promise<void> {
    await Promise.all(this.messages.map((handler) => handler({ data: JSON.stringify(value) })));
  }
  controls(): Array<Record<string, unknown>> { return this.sent.map((item) => JSON.parse(item) as Record<string, unknown>); }
}

const pipeline: AudioPipeline = {
  vad: { detect: async () => ({ speech: false, startOfSpeech: false, endOfSpeech: false }) },
  asr: { async *transcribe() {} },
  llm: { async *stream() {} },
  tts: { async *synthesize() {} },
};
const hello = (deviceId = "device-1") => ({
  type: "device.hello", protocolVersions: [2],
  device: { deviceId, platform: "ios" }, supportedCapabilities: [], availableCapabilities: [],
});

describe("realtime connection wiring", () => {
  it("uses v2 and fails closed by default without a trusted provider", async () => {
    const socket = new FakeSocket();
    attachRealtimeConnection(socket, {}, pipeline, loadRealtimeConfig({}), new InMemoryDeviceSessionOwnership());
    await socket.receive(hello());
    expect(socket.controls()[0]).toMatchObject({ type: "device.rejected", reason: "missing_trusted_identity" });
    expect(socket.closes).toHaveLength(1);
  });

  it("allows v1 only through explicit local development compatibility mode", async () => {
    const socket = new FakeSocket();
    const config = loadRealtimeConfig({ REALTIME_DEV_MODE: "1", REALTIME_DEV_V1_COMPAT: "1" });
    attachRealtimeConnection(socket, {}, pipeline, config, new InMemoryDeviceSessionOwnership());
    await socket.receive({ type: "hello", version: 1, sessionId: "legacy-session" });
    expect(socket.controls()[0]).toMatchObject({ type: "ready", sessionId: "legacy-session" });
  });

  it("development v2 identity is fixed by configuration and cannot be supplied by hello", async () => {
    const config = loadRealtimeConfig({
      REALTIME_DEV_MODE: "1", REALTIME_DEV_USER_ID: "user-1", REALTIME_DEV_DEVICE_ID: "device-1",
    });
    const ownership = new InMemoryDeviceSessionOwnership();
    const fake = new FakeSocket();
    attachRealtimeConnection(fake, {}, pipeline, config, ownership);
    await fake.receive(hello("other-device"));
    expect(fake.controls()[0]).toMatchObject({ type: "device.rejected", reason: "device_identity_mismatch" });
    const authorized = new FakeSocket();
    attachRealtimeConnection(authorized, {}, pipeline, config, ownership);
    await authorized.receive(hello());
    expect(authorized.controls()[0]).toMatchObject({ type: "device.accepted", version: 2 });
  });
});
