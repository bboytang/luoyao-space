import type { AudioFrame } from "./protocol";

export interface AudioFrameBufferOptions {
  maxFrames: number;
}

export class AudioFrameBuffer implements AsyncIterable<AudioFrame> {
  private readonly queue: AudioFrame[] = [];
  private readonly waiters: Array<(result: IteratorResult<AudioFrame>) => void> = [];
  private ended = false;

  constructor(private readonly options: AudioFrameBufferOptions) {
    if (options.maxFrames <= 0) {
      throw new Error("maxFrames must be greater than zero");
    }
  }

  push(frame: AudioFrame): void {
    if (this.ended) {
      throw new Error("Cannot push to an ended audio buffer");
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: frame, done: false });
      return;
    }

    if (this.queue.length >= this.options.maxFrames) {
      throw new Error("Audio frame buffer overflow");
    }

    this.queue.push(frame);
  }

  end(): void {
    if (this.ended) return;

    this.ended = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!({ value: undefined, done: true });
    }
  }

  clear(): void {
    this.queue.length = 0;
  }

  get size(): number {
    return this.queue.length;
  }

  async next(): Promise<IteratorResult<AudioFrame>> {
    const frame = this.queue.shift();
    if (frame) {
      return { value: frame, done: false };
    }

    if (this.ended) {
      return { value: undefined, done: true };
    }

    return new Promise<IteratorResult<AudioFrame>>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<AudioFrame> {
    return this;
  }
}
