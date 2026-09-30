import { describe, expect, it, vi } from "vitest";
import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import { AvatarLipSyncDriver, type AvatarLipSyncSource } from "./avatar-lip-sync";

function createAvatar() {
  return new AvatarRuntime({ renderer: { render: vi.fn() } });
}

function createSource(): AvatarLipSyncSource {
  return {
    getPlaybackTime: () => 10.05,
    getMouthOpenAt: (timeSeconds) => (timeSeconds >= 10 && timeSeconds < 10.1 ? 0.7 : 0),
  };
}

describe("AvatarLipSyncDriver", () => {
  it("samples mouth openness from the playback clock", () => {
    const avatar = createAvatar();
    const driver = new AvatarLipSyncDriver(avatar, createSource());

    driver.update();

    expect(avatar.getState().mouthOpen).toBe(0.7);
  });

  it("supports an externally supplied render time", () => {
    const avatar = createAvatar();
    const driver = new AvatarLipSyncDriver(avatar, createSource());

    driver.updateAt(10.2);

    expect(avatar.getState().mouthOpen).toBe(0);
  });

  it("normalizes invalid source values through AvatarRuntime", () => {
    const avatar = createAvatar();
    const source: AvatarLipSyncSource = {
      getPlaybackTime: () => Number.NaN,
      getMouthOpenAt: () => Number.NaN,
    };
    const driver = new AvatarLipSyncDriver(avatar, source);

    driver.update();

    expect(avatar.getState().mouthOpen).toBe(0);
  });
});
