import { describe, expect, it, vi } from "vitest";
import { RealtimeSession, type RealtimeAvatarControllerPort } from "./realtime-session";
import type { RealtimeTransport } from "./transport";

class FakeTransport implements RealtimeTransport {
  readonly send = vi.fn<RealtimeTransport["send"]>().mockResolvedValue(undefined);
  readonly sendAudio = vi.fn<RealtimeTransport["sendAudio"]>().mockResolvedValue(undefined);
  readonly close = vi.fn<RealtimeTransport["close"]>().mockResolvedValue(undefined);
  readonly waitUntilReady = vi.fn<RealtimeTransport["waitUntilReady"]>().mockResolvedValue(undefined);
  private readonly messages = new Set<Parameters<RealtimeTransport["onMessage"]>[0]>();
  private readonly audios = new Set<Parameters<RealtimeTransport["onAudio"]>[0]>();
  private readonly closes = new Set<Parameters<RealtimeTransport["onClose"]>[0]>();

  onMessage(handler: Parameters<RealtimeTransport["onMessage"]>[0]): () => void {
    this.messages.add(handler);
    return () => this.messages.delete(handler);
  }

  onAudio(handler: Parameters<RealtimeTransport["onAudio"]>[0]): () => void {
    this.audios.add(handler);
    return () => this.audios.delete(handler);
  }

  onClose(handler: Parameters<RealtimeTransport["onClose"]>[0]): () => void {
    this.closes.add(handler);
    return () => this.closes.delete(handler);
  }

  receiveAudio(frame: Parameters<RealtimeTransport["onAudio"]>[0] extends (frame: infer F) => unknown ? F : never): void {
    for (const handler of this.audios) void handler(frame);
  }

  receiveMessage(message: Parameters<RealtimeTransport["onMessage"]>[0] extends (message: infer M) => unknown ? M : never): void {
    for (const handler of this.messages) handler(message);
  }

  receiveClose(): void {
    for (const handler of this.closes) handler({ code: 1000, reason: "", wasClean: true });
  }
}

function createSession() {
  const transport = new FakeTransport();
  const input = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const output = {
    play: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const avatar: RealtimeAvatarControllerPort = {
    handleServerMessage: vi.fn(),
    handleAudioFrame: vi.fn(),
    getPlaybackEpoch: vi.fn().mockReturnValue(1),
    handlePlaybackIdle: vi.fn(),
    handleAborted: vi.fn(),
    handleClosed: vi.fn(),
  };
  const states: string[] = [];

  const session = new RealtimeSession({
    transport,
    input,
    output,
    avatar,
    sessionId: "session-1",
    deviceId: "device-1",
    capabilities: ["audio.pcm_s16le"],
    onStateChange: (state) => states.push(state),
  });

  return { session, transport, input, output, avatar, states };
}

describe("RealtimeSession", () => {
  it("coalesces concurrent connect calls into one handshake", async () => {
    const { session, transport } = createSession();
    let releaseReady!: () => void;
    transport.waitUntilReady.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseReady = resolve; }),
    );

    const first = session.connect();
    const second = session.connect();

    expect(transport.waitUntilReady).toHaveBeenCalledTimes(1);
    releaseReady();
    await Promise.all([first, second]);

    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenCalledWith({
      type: "hello",
      version: 1,
      sessionId: "session-1",
      deviceId: "device-1",
      capabilities: ["audio.pcm_s16le"],
    });
  });

  it("waits for transport readiness and sends configured hello", async () => {
    const { session, transport } = createSession();
    await session.connect();

    expect(transport.waitUntilReady).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenCalledWith({
      type: "hello",
      version: 1,
      sessionId: "session-1",
      deviceId: "device-1",
      capabilities: ["audio.pcm_s16le"],
    });
  });

  it("routes audio input and playback through platform-neutral contracts", async () => {
    const { session, transport, input, output, avatar } = createSession();
    await session.connect();
    await session.startListening();

    expect(input.start).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenLastCalledWith({ type: "listen", mode: "start" });

    await session.stopListening();
    expect(transport.send).toHaveBeenLastCalledWith({ type: "listen", mode: "stop" });
    expect(input.stop).toHaveBeenCalledTimes(1);

    const frame = {
      kind: "audio" as const,
      codec: "pcm_s16le" as const,
      sampleRate: 24_000,
      channels: 1,
      sequence: 1,
      payload: new Uint8Array([0, 0]),
    };
    transport.receiveAudio(frame);
    await Promise.resolve();

    expect(avatar.handleAudioFrame).toHaveBeenCalledTimes(1);
    expect(output.play).toHaveBeenCalledWith(frame);
  });

  it("coalesces concurrent listening starts", async () => {
    const { session, input, transport } = createSession();
    let releaseStart!: () => void;
    input.start.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStart = resolve; }),
    );

    const first = session.startListening();
    const second = session.startListening();

    expect(input.start).toHaveBeenCalledTimes(1);
    releaseStart();
    await Promise.all([first, second]);

    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenCalledWith({ type: "listen", mode: "start" });
  });

  it("waits for an in-flight listening start before stopping", async () => {
    const { session, input, transport } = createSession();
    let releaseStart!: () => void;
    input.start.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStart = resolve; }),
    );

    const start = session.startListening();
    const stop = session.stopListening();

    expect(transport.send).not.toHaveBeenCalledWith({ type: "listen", mode: "stop" });

    releaseStart();
    await Promise.all([start, stop]);

    expect(transport.send).toHaveBeenNthCalledWith(1, { type: "listen", mode: "start" });
    expect(transport.send).toHaveBeenNthCalledWith(2, { type: "listen", mode: "stop" });
    expect(input.stop).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent listening stops", async () => {
    const { session, input, transport } = createSession();
    await session.startListening();

    let releaseStop!: () => void;
    input.stop.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStop = resolve; }),
    );

    const first = session.stopListening();
    const second = session.stopListening();

    expect(transport.send).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(input.stop).toHaveBeenCalledTimes(1);

    releaseStop();
    await Promise.all([first, second]);

    expect(transport.send).toHaveBeenNthCalledWith(2, { type: "listen", mode: "stop" });
    expect(input.stop).toHaveBeenCalledTimes(1);
  });

  it("waits for the server to finish barge-in handoff without stopping active input", async () => {
    const { session, input, transport, output, avatar } = createSession();

    await session.startListening();
    const interrupt = session.interruptResponse();

    await vi.waitFor(() => {
      expect(output.stop).toHaveBeenCalledTimes(1);
    });

    expect(input.stop).not.toHaveBeenCalled();
    expect(avatar.handleAborted).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenNthCalledWith(2, {
      type: "abort",
      reason: "barge_in",
    });

    let settled = false;
    void interrupt.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    transport.receiveMessage({ type: "barge_in", state: "ready" });
    await interrupt;
    expect(settled).toBe(true);
  });

  it("holds input audio until barge-in handoff is acknowledged", async () => {
    const { session, input, transport } = createSession();
    let onFrame!: (frame: Parameters<RealtimeTransport["onAudio"]>[0] extends (frame: infer F) => unknown ? F : never);
    input.start.mockImplementationOnce(async (handler) => {
      onFrame = handler;
    });

    await session.startListening();

    let settled = false;
    const interrupt = session.interruptResponse().finally(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(transport.send).toHaveBeenNthCalledWith(2, {
        type: "abort",
        reason: "barge_in",
      });
    });

    const frame = {
      kind: "audio" as const,
      codec: "pcm_s16le" as const,
      sampleRate: 24_000,
      channels: 1,
      sequence: 7,
      payload: new Uint8Array([0, 0]),
    };
    onFrame(frame);

    await Promise.resolve();
    expect(transport.sendAudio).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    transport.receiveMessage({ type: "barge_in", state: "ready" });
    await interrupt;

    expect(transport.sendAudio).toHaveBeenCalledWith(frame);
  });

  it("waits for an in-flight listening start before aborting", async () => {
    const { session, input, transport, output, avatar } = createSession();
    let releaseStart!: () => void;
    input.start.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStart = resolve; }),
    );

    const start = session.startListening();
    const abort = session.abort();

    expect(transport.send).not.toHaveBeenCalledWith({ type: "abort", reason: "user_cancel" });
    expect(input.stop).not.toHaveBeenCalled();

    releaseStart();
    await Promise.all([start, abort]);

    expect(transport.send).toHaveBeenNthCalledWith(1, { type: "listen", mode: "start" });
    expect(transport.send).toHaveBeenNthCalledWith(2, { type: "abort", reason: "user_cancel" });
    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
    expect(avatar.handleAborted).toHaveBeenCalledTimes(1);
    expect(avatar.handleClosed).not.toHaveBeenCalled();

    await session.startListening();
    expect(input.start).toHaveBeenCalledTimes(2);
    expect(transport.send).toHaveBeenLastCalledWith({ type: "listen", mode: "start" });
  });

  it("waits for an in-flight listening start before closing", async () => {
    const { session, input, transport } = createSession();
    let releaseStart!: () => void;
    input.start.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseStart = resolve; }),
    );

    const start = session.startListening();
    const close = session.close();

    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(input.stop).not.toHaveBeenCalled();

    releaseStart();
    await Promise.allSettled([start, close]);

    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
    await expect(session.connect()).rejects.toThrow("RealtimeSession is closed");
  });

  it("keeps lifecycle operations terminal and idempotent", async () => {
    const { session, transport, input, output } = createSession();

    await session.close();
    await session.close();

    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
    await expect(session.connect()).rejects.toThrow("RealtimeSession is closed");
  });

  it("handles remote close as a terminal state", async () => {
    const { session, transport, input, output, avatar, states } = createSession();

    await session.connect();
    transport.receiveClose();

    expect(states).toEqual(["connecting", "connected", "closed"]);
    expect(avatar.handleClosed).toHaveBeenCalledTimes(1);
    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
  });
});
