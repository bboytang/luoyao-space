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

    controller.handleServerMessage({ type: "stt", text: "你好", final: false });
    expect(avatar.getState().activity).toBe("listening");

    controller.handleServerMessage({ type: "stt", text: "你好", final: true });
    expect(avatar.getState().activity).toBe("thinking");

    controller.handleServerMessage({ type: "tts", state: "start", messageId: "m1" });
    expect(avatar.getState().speaking).toBe(true);

    controller.handleServerMessage({ type: "tts", state: "stop", messageId: "m1" });
    expect(avatar.getState().speaking).toBe(true);

    const epoch = controller.getPlaybackEpoch();
    controller.handlePlaybackIdle(epoch);
    expect(avatar.getState().speaking).toBe(false);
  });

  it("ignores an idle callback from an older playback generation", () => {
    const avatar = createAvatar();
    const controller = new RealtimeAvatarController({ avatar });

    controller.handleServerMessage({ type: "tts", state: "start", messageId: "m1" });
    controller.handleServerMessage({ type: "tts", state: "stop", messageId: "m1" });
    const staleEpoch = controller.getPlaybackEpoch();

    controller.handleServerMessage({ type: "tts", state: "start", messageId: "m2" });
    controller.handleAudioFrame();
    controller.handlePlaybackIdle(staleEpoch);

    expect(avatar.getState().speaking).toBe(true);
  });

  it("marks the avatar as speaking when audio arrives", () => {
    const avatar = createAvatar();
    const controller = new RealtimeAvatarController({ avatar });

    controller.handleAudioFrame();

    expect(avatar.getState().speaking).toBe(true);
  });
});
