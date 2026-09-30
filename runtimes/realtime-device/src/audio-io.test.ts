import { describe, expect, it } from "vitest";
import type { RealtimeAudioInput, RealtimeAudioOutput } from "./audio-io";

describe("realtime audio IO contracts", () => {
  it("defines platform-neutral input and output lifecycles", () => {
    const input: RealtimeAudioInput = {
      start: async () => {},
      stop: async () => {},
    };
    const output: RealtimeAudioOutput = {
      play: async () => {},
      stop: async () => {},
    };

    expect(input.start).toBeTypeOf("function");
    expect(input.stop).toBeTypeOf("function");
    expect(output.play).toBeTypeOf("function");
    expect(output.stop).toBeTypeOf("function");
  });
});
