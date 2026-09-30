import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import type { AudioFrameHandler, RealtimeAudioInput, RealtimeAudioOutput } from "../../../runtimes/realtime-device/src/audio-io";
import { PcmLipSyncAnalyzer } from "../../../runtimes/realtime-device/src/lip-sync";
import { LipSyncPlaybackTimeline } from "../../../runtimes/realtime-device/src/lip-sync-playback-timeline";
import { PcmPlaybackTimeline } from "../../../runtimes/realtime-device/src/playback-timeline";

export type AudioCapture = RealtimeAudioInput;
export type AudioPlayback = RealtimeAudioOutput;

export interface BrowserAudioOptions {
  sampleRate?: number;
  frameSamples?: number;
}

/** Browser microphone adapter. Audio capture runs in an AudioWorklet and emits provider-neutral mono PCM16 frames. */
export class BrowserPcmCapture implements RealtimeAudioInput {
  private readonly sampleRate: number;
  private readonly frameSamples: number;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private sequence = 0;
  private onFrame?: AudioFrameHandler;
  private startPromise?: Promise<void>;
  private lifecycleGeneration = 0;

  constructor(options: BrowserAudioOptions = {}) {
    this.sampleRate = options.sampleRate ?? 24_000;
    this.frameSamples = options.frameSamples ?? 480;
  }

  async start(onFrame: AudioFrameHandler): Promise<void> {
    if (this.context) return;
    if (this.startPromise) return this.startPromise;

    const generation = this.lifecycleGeneration;
    const operation = this.startInternal(onFrame, generation);
    const trackedPromise = operation.finally(() => {
      if (this.startPromise === trackedPromise) this.startPromise = undefined;
    });
    this.startPromise = trackedPromise;
    return trackedPromise;
  }

  private async startInternal(onFrame: AudioFrameHandler, generation: number): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (generation !== this.lifecycleGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    this.stream = stream;
    try {
      const context = new AudioContext({ sampleRate: this.sampleRate });
      this.context = context;
      await context.resume();
      if (generation !== this.lifecycleGeneration) {
        await this.stopResources();
        return;
      }

      this.onFrame = onFrame;
      await context.audioWorklet.addModule(
        new URL("./pcm-capture-worklet.ts", import.meta.url),
      );
      if (generation !== this.lifecycleGeneration) {
        await this.stopResources();
        return;
      }

      this.source = context.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(context, "luoyao-pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: { frameSamples: this.frameSamples },
      });

      this.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        this.handleFrame(event.data);
      };

      this.source.connect(this.worklet);
      if (generation !== this.lifecycleGeneration) await this.stopResources();
    } catch (error) {
      await this.stopResources();
      throw error;
    }
  }

  private async stopResources(): Promise<void> {
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.worklet = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.context = undefined;
    this.onFrame = undefined;
  }

  private handleFrame(buffer: ArrayBuffer): void {
    const samples = new Float32Array(buffer);
    const payload = new ArrayBuffer(samples.length * 2);
    const view = new DataView(payload);

    for (let i = 0; i < samples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(i * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
    }

    this.onFrame?.({
      kind: "audio",
      codec: "pcm_s16le",
      sampleRate: this.sampleRate,
      channels: 1,
      sequence: this.sequence++,
      payload: new Uint8Array(payload),
    });
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1;
    await this.startPromise;
    await this.stopResources();
  }
}

/** Browser PCM16 player with sequential scheduling; compressed codecs stay outside this adapter. */
export class BrowserPcmPlayback implements RealtimeAudioOutput {
  private context?: AudioContext;
  private readonly timeline = new PcmPlaybackTimeline();
  private readonly lipSyncAnalyzer = new PcmLipSyncAnalyzer();
  private readonly lipSyncTimeline = new LipSyncPlaybackTimeline();
  private playTail: Promise<void> = Promise.resolve();
  private playbackGeneration = 0;
  private pendingSources = 0;
  private idleWaiters = new Set<() => void>();

  constructor(private readonly sampleRate = 24_000) {}

  play(frame: AudioFrame): Promise<void> {
    const generation = this.playbackGeneration;
    const operation = this.playTail.then(async () => {
      if (generation !== this.playbackGeneration) return;
      if (frame.codec !== "pcm_s16le" || frame.channels !== 1) {
        throw new Error("BrowserPcmPlayback requires mono pcm_s16le frames");
      }

      this.context ??= new AudioContext({ sampleRate: this.sampleRate });
      await this.context.resume();
      if (generation !== this.playbackGeneration) return;

      const samples = new Float32Array(frame.payload.byteLength / 2);
      const view = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = view.getInt16(i * 2, true) / 32768;
      }

      const buffer = this.context.createBuffer(1, samples.length, frame.sampleRate);
      buffer.copyToChannel(samples, 0);

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);

      const schedule = this.timeline.schedule(frame, this.context.currentTime);
      const sample = this.lipSyncAnalyzer.analyze(frame);
      if (sample) this.lipSyncTimeline.add(sample, schedule);

      this.pendingSources += 1;
      let ended = false;
      source.onended = () => {
        if (ended) return;
        ended = true;
        if (generation !== this.playbackGeneration) return;
        this.pendingSources -= 1;
        if (this.pendingSources === 0) {
          for (const resolve of this.idleWaiters) resolve();
          this.idleWaiters.clear();
        }
      };

      try {
        source.start(schedule.startTime);
      } catch (error) {
        source.onended = null;
        this.pendingSources -= 1;
        throw error;
      }
    });

    this.playTail = operation.catch(() => {});
    return operation;
  }

  async waitForIdle(): Promise<void> {
    await this.playTail;
    if (this.pendingSources === 0) return;

    await new Promise<void>((resolve) => {
      this.idleWaiters.add(resolve);
      if (this.pendingSources === 0) {
        this.idleWaiters.delete(resolve);
        resolve();
      }
    });
  }

  getPlaybackTime(): number {
    return this.context?.currentTime ?? 0;
  }

  getMouthOpenAt(timeSeconds: number): number {
    this.lipSyncTimeline.pruneBefore(timeSeconds);
    return this.lipSyncTimeline.sampleAt(timeSeconds);
  }

  async stop(): Promise<void> {
    this.playbackGeneration += 1;
    await this.playTail;
    await this.context?.close();
    this.context = undefined;
    this.pendingSources = 0;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
    this.timeline.reset();
    this.lipSyncTimeline.reset();
  }
}
