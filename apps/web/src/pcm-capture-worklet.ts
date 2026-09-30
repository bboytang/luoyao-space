declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

type CaptureProcessorOptions = {
  processorOptions?: {
    frameSamples?: number;
  };
};

class LuoyaoPcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly frameSamples: number;
  private readonly pending: number[] = [];

  constructor(options?: CaptureProcessorOptions) {
    super(options);
    this.frameSamples = options?.processorOptions?.frameSamples ?? 480;
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (const sample of channel) this.pending.push(sample);

    while (this.pending.length >= this.frameSamples) {
      const frame = new Float32Array(this.pending.splice(0, this.frameSamples));
      this.port.postMessage(frame.buffer, [frame.buffer]);
    }

    return true;
  }
}

registerProcessor("luoyao-pcm-capture", LuoyaoPcmCaptureProcessor);
