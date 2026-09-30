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
