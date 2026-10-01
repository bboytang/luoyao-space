import { describe, expect, it, vi } from "vitest";
import { getOrCreateWebDeviceId, probeBrowserAudioAvailability } from "./web-device";

describe("Web reference device identity", () => {
  it("persists and reuses one declared device ID", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const generate = vi.fn(() => "fixed-uuid");
    expect(getOrCreateWebDeviceId(storage, generate)).toBe("web-fixed-uuid");
    expect(getOrCreateWebDeviceId(storage, generate)).toBe("web-fixed-uuid");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("fails closed when stable storage is unavailable", () => {
    expect(() => getOrCreateWebDeviceId({
      getItem: () => null, setItem: () => { throw new Error("storage denied"); },
    }, () => "id")).toThrow("storage denied");
  });
});

describe("Web audio adapter availability", () => {
  const playback = () => ({ prepare: vi.fn().mockResolvedValue(true) });

  it("does not infer input availability from API presence when permission fails", async () => {
    const output = playback();
    vi.stubGlobal("AudioContext", class {});
    vi.stubGlobal("AudioWorkletNode", class {});
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) } });
    try {
      expect(await probeBrowserAudioAvailability(output)).toEqual({ input: false, output: true });
      expect(output.prepare).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it("checks worklet load and construction, then releases the microphone", async () => {
    const stop = vi.fn();
    const track = { stop, readyState: "live" };
    const addModule = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const portClose = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("AudioContext", class {
      state = "running";
      audioWorklet = { addModule };
      async resume() {}
      async close() { await close(); }
    });
    vi.stubGlobal("AudioWorkletNode", class { port = { close: portClose }; disconnect = disconnect; });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [track], getAudioTracks: () => [track],
    }) } });
    try {
      expect(await probeBrowserAudioAvailability(playback())).toEqual({ input: true, output: true });
      expect(addModule).toHaveBeenCalledOnce();
      expect(portClose).toHaveBeenCalledOnce();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not advertise microphone when the worklet cannot load", async () => {
    const stop = vi.fn();
    const track = { stop, readyState: "live" };
    vi.stubGlobal("AudioContext", class {
      state = "running";
      audioWorklet = { addModule: vi.fn().mockRejectedValue(new Error("blocked by CSP")) };
      async resume() {}
      async close() {}
    });
    vi.stubGlobal("AudioWorkletNode", class {});
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [track], getAudioTracks: () => [track],
    }) } });
    try {
      expect(await probeBrowserAudioAvailability(playback())).toEqual({ input: false, output: true });
      expect(stop).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not offer either audio path when playback fails preparation", async () => {
    const output = { prepare: vi.fn().mockResolvedValue(false) };
    expect(await probeBrowserAudioAvailability(output)).toEqual({ input: false, output: false });
  });
});
