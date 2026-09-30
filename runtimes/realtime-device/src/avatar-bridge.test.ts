import { describe, expect, it } from "vitest";
import type { AudioFrame } from "./protocol";
import { AvatarRealtimeBridge } from "./avatar-bridge";
import { AvatarRuntime, type AvatarRenderer } from "../../../runtimes/avatar/src/runtime";
import type { LipSyncAnalyzer } from "./lip-sync";

const frame: AudioFrame = { kind: "audio", codec: "pcm_s16le", sampleRate: 16_000, channels: 1, sequence: 1, payload: new Uint8Array([0, 1]) };

function runtime() {
  const states: unknown[] = [];
  const renderer: AvatarRenderer = { render: (state) => states.push({ ...state }) };
  return new AvatarRuntime({ renderer });
}

describe("AvatarRealtimeBridge", () => {
  it("starts speaking only when audio is emitted", () => {
    const avatar = runtime();
    const bridge = new AvatarRealtimeBridge(avatar);
    bridge.handleOutput({ type: "stt", text: "hello" });
    bridge.handleOutput({ type: "tts_audio", frame });
    expect(avatar.getState()).toMatchObject({ speaking: true, activity: "speaking" });
  });

  it("keeps speaking through sentence boundaries and stops at response completion", () => {
    const avatar = runtime();
    const bridge = new AvatarRealtimeBridge(avatar);
    bridge.handleOutput({ type: "tts_audio", frame });
    bridge.handleOutput({ type: "tts_audio", frame: { ...frame, sequence: 2 } });
    expect(avatar.getState().speaking).toBe(true);
    bridge.handleOutput({ type: "completed" });
    expect(avatar.getState()).toMatchObject({ speaking: false, activity: "idle" });
  });

  it("forwards analyzed mouth openness without exposing audio details to the avatar", () => {
    const avatar = runtime();
    const analyzer: LipSyncAnalyzer = {
      analyze: () => ({ sequence: 1, openness: 0.65, durationSeconds: 0.01 }),
    };
    const bridge = new AvatarRealtimeBridge(avatar, analyzer);
    bridge.handleOutput({ type: "tts_audio", frame });
    expect(avatar.getState()).toMatchObject({ speaking: true, mouthOpen: 0.65 });
  });

  it("clears stale mouth openness when a frame cannot be analyzed", () => {
    const avatar = runtime();
    const analyzer: LipSyncAnalyzer = { analyze: () => undefined };
    const bridge = new AvatarRealtimeBridge(avatar, analyzer);
    bridge.handleOutput({ type: "tts_audio", frame });
    expect(avatar.getState().mouthOpen).toBe(0);
  });

  it("stops speaking on abort or error", () => {
    const avatar = runtime();
    const bridge = new AvatarRealtimeBridge(avatar);
    bridge.handleOutput({ type: "tts_audio", frame });
    bridge.handleOutput({ type: "aborted" });
    expect(avatar.getState().speaking).toBe(false);
    bridge.handleOutput({ type: "tts_audio", frame });
    bridge.handleOutput({ type: "error", error: new Error("tts failed") });
    expect(avatar.getState().speaking).toBe(false);
  });
});
