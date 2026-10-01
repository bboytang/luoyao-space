import { describe, expect, it, vi } from "vitest";
import type { AcceptedDeviceSessionV2 } from "../../../packages/protocol/src/device-session";
import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import { RealtimeClient, type RealtimeClientSocket } from "./realtime-client";

class FakeSocket implements RealtimeClientSocket {
  readonly send = vi.fn<(data: string | Uint8Array) => void>();
  readonly close = vi.fn<(code?: number, reason?: string) => void>();
  private messages: Array<(event: { data: string | Uint8Array }) => void> = [];
  private closes: Array<(event: { code: number; reason: string; wasClean: boolean }) => void> = [];
  waitForOpen(): Promise<void> { return Promise.resolve(); }
  addEventListener(type: "message" | "close", listener: never): void {
    if (type === "message") this.messages.push(listener);
    else this.closes.push(listener);
  }
  receive(message: object): void { this.messages.forEach((handler) => handler({ data: JSON.stringify(message) })); }
  disconnect(): void { this.closes.forEach((handler) => handler({ code: 1000, reason: "closed", wasClean: true })); }
  sent(): object[] { return this.send.mock.calls.map(([data]) => JSON.parse(data as string) as object); }
}

function accepted(ids: string[] = []): AcceptedDeviceSessionV2 {
  return {
    type: "device.accepted", version: 2, transportSessionId: "server-session",
    ownerConnectionId: "connection-1",
    negotiatedCapabilities: ids.map((id) => id === "audio.input" || id === "audio.output"
      ? { id, format: { codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1 } }
      : { id }) as AcceptedDeviceSessionV2["negotiatedCapabilities"],
  };
}

function setup(options: {
  avatar?: boolean; availableInput?: boolean; availableOutput?: boolean;
  inputAdapter?: boolean; outputAdapter?: boolean;
} = {}) {
  const socket = new FakeSocket();
  const input = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
  const output = { play: vi.fn().mockResolvedValue(undefined), waitForIdle: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
  const avatar = new AvatarRuntime({ renderer: { render: vi.fn() } });
  const states: string[] = [];
  const client = new RealtimeClient({
    url: "wss://example.test/realtime", socket, deviceId: "stable-web-id",
    avatar: options.avatar === false ? undefined : avatar,
    input: options.inputAdapter === false ? undefined : input,
    output: options.outputAdapter === false ? undefined : output,
    availableAudio: { input: options.availableInput ?? true, output: options.availableOutput ?? true },
    onStateChange: (state) => states.push(state),
  });
  return { client, socket, input, output, avatar, states };
}

async function waitForHello(socket: FakeSocket): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(1));
  return socket.sent()[0] as Record<string, unknown>;
}

describe("Web v2 Device Session host", () => {
  it("uses canonical web identity and waits for acceptance before becoming operational", async () => {
    const { client, socket, states } = setup();
    const connecting = client.connect();
    expect(await waitForHello(socket)).toMatchObject({
      type: "device.hello", protocolVersions: [2], device: { platform: "web", deviceId: "stable-web-id" },
    });
    expect(states).toEqual(["transport_connecting", "awaiting_admission"]);
    expect(client.isOperational()).toBe(false);
    await expect(client.startListening()).rejects.toThrow("not accepted");
    socket.receive(accepted(["realtime.voice", "audio.input", "audio.output", "avatar.dynamic"]));
    await connecting;
    expect(client.isOperational()).toBe(true);
    expect(states.at(-1)).toBe("accepted");
  });

  it("surfaces machine-readable rejection without starting media", async () => {
    const { client, socket, input, output } = setup();
    const connecting = client.connect();
    await waitForHello(socket);
    socket.receive({ type: "device.rejected", reason: "device_identity_mismatch", supportedVersions: [2] });
    await expect(connecting).rejects.toMatchObject({ reason: "device_identity_mismatch" });
    expect(client.isOperational()).toBe(false);
    expect(input.start).not.toHaveBeenCalled();
    expect(output.play).not.toHaveBeenCalled();
  });

  it("does not offer unavailable audio or treat web as a capability", async () => {
    const { client, socket } = setup({ availableInput: false });
    const connecting = client.connect();
    const hello = await waitForHello(socket) as unknown as { supportedCapabilities: { id: string }[]; availableCapabilities: { id: string }[] };
    expect(hello.supportedCapabilities.map((item) => item.id)).toContain("audio.input");
    expect(hello.availableCapabilities.map((item) => item.id)).not.toContain("audio.input");
    expect(hello.availableCapabilities.map((item) => item.id)).not.toContain("realtime.voice");
    expect(hello.availableCapabilities.map((item) => item.id)).not.toContain("web");
    socket.receive(accepted(["display"]));
    await connecting;
    expect(client.canUseVoice()).toBe(false);
    await expect(client.startListening()).rejects.toThrow("not negotiated");
  });

  it("admits no-Avatar/no-audio devices and does not drive unnegotiated Avatar", async () => {
    const { client, socket, avatar } = setup();
    const activity = vi.spyOn(avatar, "setActivity");
    const connecting = client.connect();
    await waitForHello(socket);
    socket.receive(accepted(["realtime.voice", "audio.input", "audio.output"]));
    await connecting;
    socket.receive({ type: "ready", sessionId: "server-session" });
    await Promise.resolve();
    expect(client.canUseAvatar()).toBe(false);
    expect(activity).not.toHaveBeenCalled();

    const headless = setup({
      avatar: false, availableInput: false, availableOutput: false,
      inputAdapter: false, outputAdapter: false,
    });
    const headlessConnecting = headless.client.connect();
    const hello = await waitForHello(headless.socket) as unknown as {
      supportedCapabilities: object[]; availableCapabilities: object[];
    };
    expect(hello.supportedCapabilities).toEqual([]);
    expect(hello.availableCapabilities).toEqual([]);
    headless.socket.receive(accepted());
    await headlessConnecting;
    expect(headless.client.isOperational()).toBe(true);
  });

  it("preserves negotiated voice/Avatar and barge-in behavior", async () => {
    const { client, socket, avatar, input, output } = setup();
    const activity = vi.spyOn(avatar, "setActivity");
    const connecting = client.connect();
    await waitForHello(socket);
    socket.receive(accepted(["realtime.voice", "audio.input", "audio.output", "avatar.dynamic"]));
    await connecting;
    expect(client.canUseAvatar()).toBe(true);
    await client.startListening();
    expect(input.start).toHaveBeenCalledTimes(1);
    socket.receive({ type: "ready", sessionId: "server-session" });
    await vi.waitFor(() => expect(activity).toHaveBeenCalledWith("idle"));
    const interrupted = client.interruptResponse();
    await vi.waitFor(() => expect(socket.sent()).toContainEqual(expect.objectContaining({ type: "abort", reason: "barge_in" })));
    socket.receive({ type: "barge_in", state: "ready" });
    await interrupted;
    expect(input.stop).not.toHaveBeenCalled();
    expect(output.stop).toHaveBeenCalledTimes(1);
    expect(socket.sent()).toContainEqual(expect.objectContaining({ type: "abort", reason: "barge_in" }));
  });

  it("disconnect terminates this transport and reconnect requires a new client", async () => {
    const { client, socket } = setup();
    const connecting = client.connect();
    await waitForHello(socket);
    socket.receive(accepted());
    await connecting;
    socket.disconnect();
    expect(client.isOperational()).toBe(false);
    await expect(client.connect()).rejects.toThrow("create a new client");
  });

  it("waits for old voice adapter cleanup before a host can reuse it", async () => {
    const { client, socket, output } = setup();
    let release!: () => void;
    const stopped = new Promise<void>((resolve) => { release = resolve; });
    output.stop.mockImplementation(() => stopped);
    const connecting = client.connect();
    await waitForHello(socket);
    socket.receive(accepted(["realtime.voice", "audio.input", "audio.output"]));
    await connecting;
    socket.disconnect();
    let complete = false;
    const cleanup = client.close().then(() => { complete = true; });
    await Promise.resolve();
    expect(complete).toBe(false);
    release();
    await cleanup;
    expect(complete).toBe(true);
  });

  it("loads protocol and runtime in Node without DOM globals", () => {
    expect(globalThis.document).toBeUndefined();
  });
});
