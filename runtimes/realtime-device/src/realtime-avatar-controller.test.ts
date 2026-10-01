import { describe, expect, it, vi } from "vitest";
import { RealtimeAvatarController, type RealtimeAvatarStateController } from "./realtime-avatar-controller";

function createAvatar() {
  let activity: "idle" | "listening" | "thinking" | "speaking" = "idle";
  let speaking = false;

  const avatar: RealtimeAvatarStateController = {
    setActivity: vi.fn((next) => { activity = next; }),
    setSpeaking: vi.fn((next) => { speaking = next; }),
  };

  return {
    avatar,
    getActivity: () => activity,
    getSpeaking: () => speaking,
  };
}

describe("RealtimeAvatarController", () => {
  it("maps realtime speech lifecycle into avatar activity", () => {
    const { avatar, getActivity, getSpeaking } = createAvatar();
    const controller = new RealtimeAvatarController(avatar);

    controller.handleServerMessage({ type: "stt", text: "你好", final: false });
    expect(getActivity()).toBe("listening");

    controller.handleServerMessage({ type: "stt", text: "你好", final: true });
    expect(getActivity()).toBe("thinking");

    controller.handleServerMessage({ type: "tts", state: "start", messageId: "m1" });
    expect(getSpeaking()).toBe(true);

    controller.handleServerMessage({ type: "tts", state: "stop", messageId: "m1" });
    expect(getSpeaking()).toBe(true);

    const epoch = controller.getPlaybackEpoch();
    controller.handlePlaybackIdle(epoch);
    expect(getSpeaking()).toBe(false);
  });

  it("ignores an idle callback from an older playback generation", () => {
    const { avatar, getSpeaking } = createAvatar();
    const controller = new RealtimeAvatarController(avatar);

    controller.handleServerMessage({ type: "tts", state: "start", messageId: "m1" });
    controller.handleServerMessage({ type: "tts", state: "stop", messageId: "m1" });
    const staleEpoch = controller.getPlaybackEpoch();

    controller.handleServerMessage({ type: "tts", state: "start", messageId: "m2" });
    controller.handleAudioFrame();
    controller.handlePlaybackIdle(staleEpoch);

    expect(getSpeaking()).toBe(true);
  });

  it("ignores stale audio after abort until a new tts turn starts", () => {
    const { avatar, getSpeaking } = createAvatar();
    const controller = new RealtimeAvatarController(avatar);

    controller.handleServerMessage({ type: "tts", state: "start", messageId: "m1" });
    controller.handleAborted();
    controller.handleAudioFrame();

    expect(getSpeaking()).toBe(false);

    controller.handleServerMessage({ type: "tts", state: "start", messageId: "m2" });
    controller.handleAudioFrame();

    expect(getSpeaking()).toBe(true);
  });

  it("marks the avatar as speaking when audio arrives during an active tts turn", () => {
    const { avatar, getSpeaking } = createAvatar();
    const controller = new RealtimeAvatarController(avatar);

    controller.handleServerMessage({ type: "tts", state: "start", messageId: "m1" });
    controller.handleAudioFrame();

    expect(getSpeaking()).toBe(true);
    expect(avatar.setSpeaking).toHaveBeenCalledWith(true);
  });
});
