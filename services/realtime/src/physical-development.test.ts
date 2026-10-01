import { describe, expect, it } from "vitest";
import type { AudioPipeline } from "../../../runtimes/realtime-device/src/audio-pipeline";
import { InMemoryDeviceSessionOwnership } from "../../device-runtime/src/session-boundary";
import type { ServerWebSocketLike } from "./websocket-session-connection";
import { loadRealtimeConfig } from "./config";
import { attachRealtimeConnection } from "./connection-factory";
import { createPhysicalDevelopmentProviders } from "./physical-development";

class FakeSocket implements ServerWebSocketLike {
  readonly sent: string[] = [];
  readonly closes: number[] = [];
  private messages: Array<(event: { data: string }) => void | Promise<void>> = [];
  private closeHandlers: Array<() => void> = [];
  send(data: string | Uint8Array): void { if (typeof data === "string") this.sent.push(data); }
  close(code?: number): void { this.closes.push(code ?? 1000); for (const handler of this.closeHandlers) handler(); }
  addEventListener(type: "message" | "close", listener: ((event: { data: string }) => void | Promise<void>) | (() => void)): void {
    if (type === "message") this.messages.push(listener as (event: { data: string }) => void | Promise<void>);
    else this.closeHandlers.push(listener as () => void);
  }
  async receive(value: unknown): Promise<void> {
    await Promise.all(this.messages.map((handler) => handler({ data: JSON.stringify(value) })));
  }
  response(): Record<string, unknown> { return JSON.parse(this.sent[0] ?? "null") as Record<string, unknown>; }
}

const pipeline: AudioPipeline = {
  vad: { detect: async () => ({ speech: false, startOfSpeech: false, endOfSpeech: false }) },
  asr: { async *transcribe() {} },
  llm: { async *stream() {} },
  tts: { async *synthesize() {} },
};
const secret = "a".repeat(64);
const config = loadRealtimeConfig({
  REALTIME_PHYSICAL_DEV_MODE: "1", REALTIME_PHYSICAL_DEV_TOKEN: secret,
  REALTIME_PHYSICAL_DEV_USER_ID: "trusted-user", REALTIME_PHYSICAL_DEV_DEVICE_ID: "authorized-phone",
});
const hello = (deviceId: string, extra: Record<string, unknown> = {}) => ({
  type: "device.hello", protocolVersions: [2],
  device: { deviceId, platform: "ios" }, supportedCapabilities: [], availableCapabilities: [], ...extra,
});

async function admit(authorization: string | undefined, deviceId = "authorized-phone", extra = {}): Promise<FakeSocket> {
  const socket = new FakeSocket();
  const context = { headers: { authorization } };
  attachRealtimeConnection(socket, context, pipeline, config, new InMemoryDeviceSessionOwnership(),
    createPhysicalDevelopmentProviders(config.physicalDevelopment!));
  await socket.receive(hello(deviceId, extra));
  return socket;
}

describe("physical iPhone development admission", () => {
  it("resolves the configured principal from the handshake token only", async () => {
    const providers = createPhysicalDevelopmentProviders(config.physicalDevelopment!);
    const principal = await providers.principalProvider!.resolve({ headers: { authorization: `Bearer ${secret}` } });
    expect(principal).toEqual({ userId: "trusted-user" });
    expect(await providers.principalProvider!.resolve({ headers: {} })).toBeNull();
  });

  it("rejects missing and incorrect handshake tokens before v2 admission", async () => {
    for (const header of [undefined, `Bearer ${"b".repeat(64)}`, "Bearer short"]) {
      const socket = await admit(header);
      expect(socket.response()).toMatchObject({ type: "device.rejected", reason: "missing_trusted_identity" });
      expect(socket.closes).toHaveLength(1);
      expect(socket.sent.join(" ")).not.toContain(secret);
    }
  });

  it("accepts only the configured token and configured authorized device", async () => {
    const socket = await admit(`Bearer ${secret}`);
    expect(socket.response()).toMatchObject({ type: "device.accepted", version: 2 });
    expect(socket.closes).toHaveLength(0);
    expect(socket.sent.join(" ")).not.toContain(secret);
  });

  it("still runs M1-B device authorization after token validation", async () => {
    const socket = await admit(`Bearer ${secret}`, "other-phone");
    expect(socket.response()).toMatchObject({ type: "device.rejected", reason: "device_identity_mismatch" });
    expect(socket.closes).toHaveLength(1);
  });

  it("never trusts a hello deviceId or self-asserted principal as authentication", async () => {
    const socket = await admit(undefined, "authorized-phone", { principal: { userId: "trusted-user" } });
    expect(socket.response()).toMatchObject({ type: "device.rejected", reason: "missing_trusted_identity" });
  });
});
