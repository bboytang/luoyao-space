import { describe, expect, it, vi } from "vitest";
import type { AcceptedDeviceSessionV2, DeviceSessionHelloV2 } from "../../../packages/protocol/src/device-session";
import { DeviceSessionClient } from "./device-session-client";
import { MemoryRealtimeTransport } from "./memory-transport";
import type { AudioFrame } from "./protocol";
import type { RealtimeServerMessage } from "./protocol";

const headlessHello: DeviceSessionHelloV2 = {
  type: "device.hello",
  protocolVersions: [2],
  device: { deviceId: "headless-1", platform: "iot" },
  supportedCapabilities: [],
  availableCapabilities: [],
};
const format = { codec: "pcm_s16le" as const, sampleRateHz: 24_000, channels: 1 };
const voiceHello: DeviceSessionHelloV2 = {
  ...headlessHello,
  supportedCapabilities: [
    { id: "realtime.voice" }, { id: "audio.input", formats: [format] },
    { id: "audio.output", formats: [format] },
  ],
  availableCapabilities: [
    { id: "realtime.voice" }, { id: "audio.input", formats: [format] },
    { id: "audio.output", formats: [format] },
  ],
};
const voiceAccepted = {
  type: "device.accepted" as const, version: 2 as const,
  transportSessionId: "voice-session", ownerConnectionId: "owner-1",
  negotiatedCapabilities: [
    { id: "realtime.voice" as const }, { id: "audio.input" as const, format },
    { id: "audio.output" as const, format },
  ],
};

describe("DeviceSessionClient v2 admission", () => {
  it("lets the host await voice cleanup after a remote transport close", async () => {
    const transport = new MemoryRealtimeTransport();
    let releaseOutput!: () => void;
    const outputStop = new Promise<void>((resolve) => { releaseOutput = resolve; });
    const input = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const output = {
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(() => outputStop),
    };
    const client = new DeviceSessionClient({ transport, hello: voiceHello, input, output });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession(voiceAccepted);
    await connecting;

    await transport.close();
    let cleaned = false;
    const cleanup = client.close().then(() => { cleaned = true; });
    await Promise.resolve();
    expect(cleaned).toBe(false);
    releaseOutput();
    await cleanup;
    expect(cleaned).toBe(true);
  });

  it("does not become operational when the transport opens or hello is sent", async () => {
    const transport = new MemoryRealtimeTransport();
    const client = new DeviceSessionClient({ transport, hello: headlessHello });
    let settled = false;
    const connecting = client.connect().finally(() => { settled = true; });

    await Promise.resolve();
    expect(transport.sentDeviceHellos).toEqual([headlessHello]);
    expect(client.getState()).toBe("awaiting_admission");
    expect(settled).toBe(false);

    await transport.receiveDeviceSession({
      type: "device.accepted", version: 2,
      transportSessionId: "transport-1", ownerConnectionId: "owner-1",
      negotiatedCapabilities: [],
    });
    await expect(connecting).resolves.toMatchObject({ transportSessionId: "transport-1" });
    expect(client.getState()).toBe("accepted");
  });

  it("surfaces machine-readable rejection and never permits media operations", async () => {
    const transport = new MemoryRealtimeTransport();
    const client = new DeviceSessionClient({ transport, hello: headlessHello });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession({
      type: "device.rejected", reason: "device_identity_mismatch", supportedVersions: [2],
    });
    await expect(connecting).rejects.toMatchObject({ reason: "device_identity_mismatch", supportedVersions: [2] });
    expect(client.getState()).toBe("rejected");
    expect(transport.isClosed).toBe(true);
    await expect(client.startListening()).rejects.toThrow();
    expect(transport.sentAudio).toEqual([]);
  });

  it("keeps a rejection deterministic even if transport close itself fails", async () => {
    class FailingCloseTransport extends MemoryRealtimeTransport {
      override async close(): Promise<void> { throw new Error("socket close failed"); }
    }
    const transport = new FailingCloseTransport();
    const client = new DeviceSessionClient({ transport, hello: headlessHello });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession({
      type: "device.rejected", reason: "unsupported_version", supportedVersions: [2],
    });
    await expect(connecting).rejects.toMatchObject({ reason: "unsupported_version" });
    expect(client.getState()).toBe("rejected");
  });

  it("accepts without audio, avatar or display and does not activate unavailable or unnegotiated adapters", async () => {
    const transport = new MemoryRealtimeTransport();
    const input = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const output = { play: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const avatar = {
      handleServerMessage: vi.fn(), handleAudioFrame: vi.fn(), getPlaybackEpoch: () => 1,
      handlePlaybackIdle: vi.fn(), handleAborted: vi.fn(), handleClosed: vi.fn(),
    };
    const hello: DeviceSessionHelloV2 = {
      ...headlessHello,
      supportedCapabilities: [
        { id: "realtime.voice" }, { id: "avatar.dynamic" },
        { id: "audio.input", formats: [{ codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1 }] },
        { id: "audio.output", formats: [{ codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1 }] },
      ],
      availableCapabilities: [
        { id: "realtime.voice" }, { id: "avatar.dynamic" },
        { id: "audio.input", formats: [{ codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1 }] },
        { id: "audio.output", formats: [{ codec: "pcm_s16le", sampleRateHz: 24_000, channels: 1 }] },
      ],
    };
    const client = new DeviceSessionClient({ transport, hello, input, output, avatar });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession({
      type: "device.accepted", version: 2, transportSessionId: "t-2",
      ownerConnectionId: "c-2", negotiatedCapabilities: [],
    });
    await connecting;
    await expect(client.startListening()).rejects.toThrow(/voice.*negotiated/i);
    await transport.receiveMessage({ type: "tts", state: "stop", messageId: "old" });
    expect(input.start).not.toHaveBeenCalled();
    expect(output.play).not.toHaveBeenCalled();
    expect(avatar.handleServerMessage).not.toHaveBeenCalled();
  });

  it("preserves negotiated voice input and output without sending a v1 hello or driving an unnegotiated avatar", async () => {
    const transport = new MemoryRealtimeTransport();
    let capture!: (frame: AudioFrame) => void;
    const input = { start: vi.fn(async (handler: (frame: AudioFrame) => void) => { capture = handler; }), stop: vi.fn().mockResolvedValue(undefined) };
    const output = { play: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const avatar = {
      handleServerMessage: vi.fn(), handleAudioFrame: vi.fn(), getPlaybackEpoch: () => 1,
      handlePlaybackIdle: vi.fn(), handleAborted: vi.fn(), handleClosed: vi.fn(),
    };
    const client = new DeviceSessionClient({ transport, hello: voiceHello, input, output, avatar });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession(voiceAccepted);
    await connecting;
    await client.startListening();
    const frame: AudioFrame = {
      kind: "audio", codec: "pcm_s16le", sampleRate: 24_000,
      channels: 1, sequence: 1, payload: new Uint8Array([0, 1]),
    };
    capture(frame);
    await vi.waitFor(() => expect(transport.sentAudio).toEqual([frame]));
    await transport.receiveAudio(frame);
    await vi.waitFor(() => expect(output.play).toHaveBeenCalledWith(frame));
    expect(transport.sentMessages).toEqual([{ type: "listen", mode: "start" }]);
    expect(avatar.handleAudioFrame).not.toHaveBeenCalled();
    await client.close();
    expect(input.stop).toHaveBeenCalled();
    expect(output.stop).toHaveBeenCalled();
  });

  it("does not trust an accepted capability that was not currently available", async () => {
    const transport = new MemoryRealtimeTransport();
    const client = new DeviceSessionClient({ transport, hello: headlessHello });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession(voiceAccepted);
    await expect(connecting).rejects.toThrow(/unoffered|invalid/i);
    expect(client.getState()).not.toBe("accepted");
    expect(transport.isClosed).toBe(true);
  });

  it("fails closed on a malformed accepted capability instead of hanging admission", async () => {
    const transport = new MemoryRealtimeTransport();
    const client = new DeviceSessionClient({ transport, hello: headlessHello });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession({
      type: "device.accepted", version: 2, transportSessionId: "t-1",
      ownerConnectionId: "c-1", negotiatedCapabilities: [null],
    } as unknown as AcceptedDeviceSessionV2);
    await expect(connecting).rejects.toThrow(/invalid/i);
    expect(transport.isClosed).toBe(true);
  });

  it("does not operate negotiated voice when its required local audio adapters are absent", async () => {
    const transport = new MemoryRealtimeTransport();
    const client = new DeviceSessionClient({ transport, hello: voiceHello });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession(voiceAccepted);
    await expect(connecting).rejects.toThrow(/requires available audio adapters/i);
    expect(client.getState()).toBe("terminated");
    expect(transport.isClosed).toBe(true);
  });

  it("uses only the selected input and output audio formats after negotiation", async () => {
    const transport = new MemoryRealtimeTransport();
    let capture!: (frame: AudioFrame) => void;
    const input = { start: vi.fn(async (handler: (frame: AudioFrame) => void) => { capture = handler; }), stop: vi.fn().mockResolvedValue(undefined) };
    const output = { play: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const avatar = {
      handleServerMessage: vi.fn(), handleAudioFrame: vi.fn(), getPlaybackEpoch: () => 1,
      handlePlaybackIdle: vi.fn(), handleAborted: vi.fn(), handleClosed: vi.fn(),
    };
    const otherFormat = { codec: "pcm_s16le" as const, sampleRateHz: 48_000, channels: 1 };
    const hello: DeviceSessionHelloV2 = {
      ...voiceHello,
      supportedCapabilities: [
        { id: "realtime.voice" }, { id: "audio.input", formats: [format, otherFormat] },
        { id: "audio.output", formats: [format, otherFormat] }, { id: "avatar.dynamic" },
      ],
      availableCapabilities: [
        { id: "realtime.voice" }, { id: "audio.input", formats: [format, otherFormat] },
        { id: "audio.output", formats: [format, otherFormat] }, { id: "avatar.dynamic" },
      ],
    };
    const client = new DeviceSessionClient({ transport, hello, input, output, avatar });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession({
      ...voiceAccepted,
      negotiatedCapabilities: [...voiceAccepted.negotiatedCapabilities, { id: "avatar.dynamic" }],
    });
    await connecting;
    await client.startListening();
    const wrong: AudioFrame = {
      kind: "audio", codec: "pcm_s16le", sampleRate: 48_000,
      channels: 1, sequence: 1, payload: new Uint8Array([0, 1]),
    };
    capture(wrong);
    await transport.receiveAudio(wrong);
    await Promise.resolve();
    expect(transport.sentAudio).toEqual([]);
    expect(output.play).not.toHaveBeenCalled();
    expect(avatar.handleAudioFrame).not.toHaveBeenCalled();

    const selected = { ...wrong, sampleRate: 24_000, sequence: 2 };
    capture(selected);
    await transport.receiveAudio(selected);
    await vi.waitFor(() => expect(transport.sentAudio).toEqual([selected]));
    expect(output.play).toHaveBeenCalledWith(selected);
    expect(avatar.handleAudioFrame).toHaveBeenCalledTimes(1);
  });

  it("does not create duplicate voice listeners from concurrent accepted responses", async () => {
    class DelayedVoiceTransport extends MemoryRealtimeTransport {
      private calls = 0;
      releaseVoice?: () => void;
      override waitUntilReady(): Promise<void> {
        this.calls += 1;
        if (this.calls === 1) return Promise.resolve();
        return new Promise<void>((resolve) => { this.releaseVoice = resolve; });
      }
    }
    const transport = new DelayedVoiceTransport();
    const input = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const output = { play: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const client = new DeviceSessionClient({ transport, hello: voiceHello, input, output });
    const connecting = client.connect();
    await Promise.resolve();
    const first = transport.receiveDeviceSession(voiceAccepted);
    const duplicate = transport.receiveDeviceSession(voiceAccepted);
    await vi.waitFor(() => expect(transport.releaseVoice).toBeDefined());
    transport.releaseVoice?.();
    await Promise.all([first, duplicate, connecting]);
    const frame: AudioFrame = {
      kind: "audio", codec: "pcm_s16le", sampleRate: 24_000,
      channels: 1, sequence: 1, payload: new Uint8Array([0, 1]),
    };
    await transport.receiveAudio(frame);
    await vi.waitFor(() => expect(output.play).toHaveBeenCalledTimes(1));
  });

  it("keeps supported but currently unavailable voice inactive without audio adapters", async () => {
    const transport = new MemoryRealtimeTransport();
    const client = new DeviceSessionClient({
      transport, hello: { ...voiceHello, availableCapabilities: [] },
    });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession({ ...voiceAccepted, negotiatedCapabilities: [] });
    await expect(connecting).resolves.toMatchObject({ transportSessionId: "voice-session" });
    await expect(client.startListening()).rejects.toThrow(/voice.*negotiated/i);
    expect(transport.sentAudio).toEqual([]);
  });

  it("disconnects terminally and a new client receives a new transport session", async () => {
    const firstTransport = new MemoryRealtimeTransport();
    const first = new DeviceSessionClient({ transport: firstTransport, hello: headlessHello });
    const firstConnect = first.connect();
    await Promise.resolve();
    await firstTransport.receiveDeviceSession({
      type: "device.accepted", version: 2, transportSessionId: "old-session",
      ownerConnectionId: "owner-1", negotiatedCapabilities: [],
    });
    await firstConnect;
    await first.close();
    expect(first.getState()).toBe("terminated");
    await expect(first.connect()).rejects.toThrow(/new client/i);

    const secondTransport = new MemoryRealtimeTransport();
    const second = new DeviceSessionClient({ transport: secondTransport, hello: headlessHello });
    const secondConnect = second.connect();
    await Promise.resolve();
    await secondTransport.receiveDeviceSession({
      type: "device.accepted", version: 2, transportSessionId: "new-session",
      ownerConnectionId: "owner-2", negotiatedCapabilities: [],
    });
    await expect(secondConnect).resolves.toMatchObject({ transportSessionId: "new-session" });
  });

  it("keeps barge-in audio behind the handoff and user cancel inside the accepted session", async () => {
    const transport = new MemoryRealtimeTransport();
    let capture!: (frame: AudioFrame) => void;
    const input = { start: vi.fn(async (handler: (frame: AudioFrame) => void) => { capture = handler; }), stop: vi.fn().mockResolvedValue(undefined) };
    const output = { play: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const client = new DeviceSessionClient({ transport, hello: voiceHello, input, output });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession(voiceAccepted);
    await connecting;
    await client.startListening();

    const interrupt = client.interruptResponse();
    await vi.waitFor(() => expect(transport.sentMessages).toContainEqual({ type: "abort", reason: "barge_in" }));
    const frame: AudioFrame = {
      kind: "audio", codec: "pcm_s16le", sampleRate: 24_000,
      channels: 1, sequence: 7, payload: new Uint8Array([0, 1]),
    };
    capture(frame);
    await Promise.resolve();
    expect(transport.sentAudio).toEqual([]);
    await transport.receiveMessage({ type: "barge_in", state: "ready" });
    await interrupt;
    await vi.waitFor(() => expect(transport.sentAudio).toEqual([frame]));

    await client.abort();
    expect(transport.sentMessages).toContainEqual({ type: "abort", reason: "user_cancel" });
    expect(input.stop).toHaveBeenCalledTimes(1);
    await client.close();
    capture({ ...frame, sequence: 8 });
    await Promise.resolve();
    expect(transport.sentAudio).toEqual([frame]);
  });

  it("does not send media or control while admission is pending", async () => {
    const transport = new MemoryRealtimeTransport();
    const client = new DeviceSessionClient({ transport, hello: voiceHello });
    const connecting = client.connect();
    await Promise.resolve();
    await expect(client.startListening()).rejects.toThrow(/not accepted/i);
    await expect(client.abort()).rejects.toThrow(/not accepted/i);
    expect(transport.sentMessages).toEqual([]);
    expect(transport.sentAudio).toEqual([]);
    await client.close();
    await expect(connecting).rejects.toThrow(/closed/i);
  });

  it("remote disconnect terminates the session and ignores delayed old-connection events", async () => {
    class DelayedTransport extends MemoryRealtimeTransport {
      staleMessage?: (message: RealtimeServerMessage) => void | Promise<void>;
      staleAudio?: (frame: AudioFrame) => void | Promise<void>;
      override onMessage(handler: (message: RealtimeServerMessage) => void | Promise<void>): () => void {
        this.staleMessage = handler;
        return super.onMessage(handler);
      }
      override onAudio(handler: (frame: AudioFrame) => void | Promise<void>): () => void {
        this.staleAudio = handler;
        return super.onAudio(handler);
      }
    }
    const transport = new DelayedTransport();
    const input = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const output = { play: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const avatar = {
      handleServerMessage: vi.fn(), handleAudioFrame: vi.fn(), getPlaybackEpoch: () => 1,
      handlePlaybackIdle: vi.fn(), handleAborted: vi.fn(), handleClosed: vi.fn(),
    };
    const hello: DeviceSessionHelloV2 = {
      ...voiceHello,
      supportedCapabilities: [...voiceHello.supportedCapabilities, { id: "avatar.dynamic" }],
      availableCapabilities: [...voiceHello.availableCapabilities, { id: "avatar.dynamic" }],
    };
    const client = new DeviceSessionClient({ transport, hello, input, output, avatar });
    const connecting = client.connect();
    await Promise.resolve();
    await transport.receiveDeviceSession({
      ...voiceAccepted,
      negotiatedCapabilities: [...voiceAccepted.negotiatedCapabilities, { id: "avatar.dynamic" }],
    });
    await connecting;
    await transport.close(1006, "remote disconnected");
    expect(client.getState()).toBe("terminated");
    await vi.waitFor(() => expect(output.stop).toHaveBeenCalledTimes(1));
    expect(avatar.handleClosed).toHaveBeenCalledTimes(1);
    expect(input.stop).toHaveBeenCalledTimes(1);
    transport.staleMessage?.({ type: "tts", state: "stop", messageId: "stale" });
    transport.staleAudio?.({
      kind: "audio", codec: "pcm_s16le", sampleRate: 24_000,
      channels: 1, sequence: 99, payload: new Uint8Array([0, 1]),
    });
    await Promise.resolve();
    expect(output.play).not.toHaveBeenCalled();
    expect(avatar.handleServerMessage).not.toHaveBeenCalled();
    expect(avatar.handleAudioFrame).not.toHaveBeenCalled();
    await expect(client.connect()).rejects.toThrow(/new client/i);
  });
});
