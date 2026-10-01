import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import type { RealtimeAudioInput } from "../../../runtimes/realtime-device/src/audio-io";
import type { RealtimeBargeInController } from "./realtime-barge-in";

export class RealtimeBargeInInput implements RealtimeAudioInput {
  constructor(
    private readonly source: RealtimeAudioInput,
    private readonly controller: RealtimeBargeInController,
  ) {}

  async start(onFrame: (frame: AudioFrame) => void): Promise<void> {
    this.controller.reset();
    await this.source.start((frame) => {
      void this.controller.handleFrame(frame).then(() => {
        onFrame(frame);
      });
    });
  }

  async stop(): Promise<void> {
    this.controller.reset();
    await this.source.stop();
  }
}
