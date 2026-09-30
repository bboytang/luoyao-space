import { describe, expect, it, vi } from "vitest";
import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import { RealtimeAvatarController } from "./realtime-avatar-controller";

function createAvatar() {
  return new AvatarRuntime({ renderer: { render: vi.fn() } });
}

describe("RealtimeAvatarController", () => {
  it("maps realtime speech lifecycle into avatar activity", () => {
    const avatar = createAvatar();
    const controller = new RealtimeAvatarController({ avatar });

    controller.handleServerMessage({
      type: "stt",
      text: "你好",
      final: false,
    });
    expect(avatar.getState().activity).toBe("listening");

    controller.handleServerMessage({
      type: "stt",
      text: "你好",
      final: true,
    });
    expect(avatar.getState().activity).toBe("thinking");

    controller.handleServerMessage({
      type: "tts",
      state: "start",
      messageId: "m1",
    });
    expect(avatar.getState().speaking).toBe(true);

    controller.handleServerMessage({
      type: "tts",
      state: "stop",
      messageId: "m1",
    });
    expect(avatar.getState().speaking).toBe(false);
  });

  it("forwards output audio without owning playback", () => {
    const avatar = createAvatar();
    const onAudio = vi.fn();
    const controller = new RealtimeAvatarController({ avatar, onAudio });
    const frame = {
      kind: "audio" as const,
      codec: "pcm_s16le" as const,
      sampleRate: 24_000,
      channels: 1,
      sequence: 1,
      payload: new Uint8Array([0, 0]),
    };

    controller.handleAudioFrame(frame);

    expect(avatar.getState().speaking).toBe(true);
    expect(onAudio).toHaveBeenCalledWith(frame);
  });
});
