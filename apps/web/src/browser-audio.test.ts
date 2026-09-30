import { describe, expect, it, vi } from "vitest";
import { BrowserPcmCapture, BrowserPcmPlayback } from "./browser-audio";

describe("browser audio adapters", () => {
  it("exposes separate capture and playback adapters", () => {
    expect(new BrowserPcmCapture()).toBeInstanceOf(BrowserPcmCapture);
    expect(new BrowserPcmPlayback()).toBeInstanceOf(BrowserPcmPlayback);
  });

  it("cleans up a capture start that loses a race with stop", async () => {
    let releaseGetUserMedia!: (stream: { getTracks(): Array<{ stop(): void }> }) => void;
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(
          () =>
            new Promise<{ getTracks(): Array<{ stop(): void }> }>((resolve) => {
              releaseGetUserMedia = resolve;
            }),
        ),
      },
    });

    const capture = new BrowserPcmCapture();
    const startPromise = capture.start(() => {});
    const stopPromise = capture.stop();

    releaseGetUserMedia(stream);
    await Promise.all([startPromise, stopPromise]);

    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("cleans up resources when capture startup fails", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    const close = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });

    class FakeAudioContext {
      readonly audioWorklet = {
        addModule: vi.fn().mockRejectedValue(new Error("worklet failed")),
      };
      async resume(): Promise<void> {}
      async close(): Promise<void> {
        await close();
      }
    }

    vi.stubGlobal("AudioContext", FakeAudioContext);

    const capture = new BrowserPcmCapture();

    await expect(capture.start(() => {})).rejects.toThrow("worklet failed");

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rolls back failed playback scheduling", async () => {
    const sources: Array<{ onended: (() => void) | null; start: ReturnType<typeof vi.fn> }> = [];

    class FakeAudioContext {
      static failNextStart = true;
      currentTime = 10;
      readonly destination = {};

      async resume(): Promise<void> {}

      createBuffer(): { copyToChannel(): void } {
        return { copyToChannel: vi.fn() };
      }

      createBufferSource(): {
        buffer: unknown;
        onended: (() => void) | null;
        connect(): void;
        start: ReturnType<typeof vi.fn>;
      } {
        const start = vi.fn(() => {
          if (FakeAudioContext.failNextStart) {
            FakeAudioContext.failNextStart = false;
            throw new Error("start failed");
          }
        });
        const source = {
          buffer: undefined as unknown,
          onended: null as (() => void) | null,
          connect: vi.fn(),
          start,
        };
        sources.push(source);
        return source;
      }

      async close(): Promise<void> {}
    }

    vi.stubGlobal("AudioContext", FakeAudioContext);

    const playback = new BrowserPcmPlayback(8_000);
    const frame = {
      kind: "audio" as const,
      codec: "pcm_s16le" as const,
      sampleRate: 8_000,
      channels: 1,
      sequence: 0,
      payload: new Uint8Array([0, 0]),
    };

    await expect(playback.play(frame)).rejects.toThrow("start failed");
    await playback.play({ ...frame, sequence: 1 });

    expect(sources[1].start).toHaveBeenCalledWith(10);
    expect(playback.getMouthOpenAt(10.01)).toBe(0);
  });

  it("ignores stale playback end callbacks after stop", async () => {
    const sources: Array<{ onended: (() => void) | null; start: ReturnType<typeof vi.fn> }> = [];

    class FakeAudioContext {
      currentTime = 0;
      readonly destination = {};

      async resume(): Promise<void> {}

      createBuffer(_channels: number, length: number, _sampleRate: number): {
        copyToChannel(samples: Float32Array, channel: number): void;
      } {
        return {
          copyToChannel: vi.fn((samples: Float32Array, channel: number) => {
            expect(channel).toBe(0);
            expect(samples.length).toBe(length);
          }),
        };
      }

      createBufferSource(): {
        buffer: unknown;
        onended: (() => void) | null;
        connect(): void;
        start: ReturnType<typeof vi.fn>;
      } {
        const source = {
          buffer: undefined as unknown,
          onended: null as (() => void) | null,
          connect: vi.fn(),
          start: vi.fn(),
        };
        sources.push(source);
        return source;
      }

      async close(): Promise<void> {}
    }

    vi.stubGlobal("AudioContext", FakeAudioContext);

    const playback = new BrowserPcmPlayback(8_000);
    const frame = {
      kind: "audio" as const,
      codec: "pcm_s16le" as const,
      sampleRate: 8_000,
      channels: 1,
      sequence: 0,
      payload: new Uint8Array([0, 0]),
    };

    await playback.play(frame);
    const staleSource = sources[0];
    await playback.stop();

    await playback.play({ ...frame, sequence: 1 });
    const currentSource = sources[1];
    const idle = playback.waitForIdle();
    let idleResolved = false;
    void idle.then(() => {
      idleResolved = true;
    });

    staleSource.onended?.();
    await Promise.resolve();
    expect(idleResolved).toBe(false);

    currentSource.onended?.();
    await idle;
    expect(idleResolved).toBe(true);
  });

  it("can start again after a completed capture stop", async () => {
    const tracks = [
      { stop: vi.fn() },
      { stop: vi.fn() },
    ];
    const streams = tracks.map((track) => ({ getTracks: () => [track] }));
    let streamIndex = 0;

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => streams[streamIndex++]),
      },
    });

    class FakeAudioContext {
      readonly audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      readonly destination = {};
      async resume(): Promise<void> {}
      createMediaStreamSource(): { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      async close(): Promise<void> {}
    }

    class FakeAudioWorkletNode {
      readonly port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null, close: vi.fn() };
      connect = vi.fn();
      disconnect = vi.fn();
    }

    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);

    const capture = new BrowserPcmCapture();

    await capture.start(() => {});
    await capture.stop();
    await capture.start(() => {});

    expect(streamIndex).toBe(2);
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
  });

});
