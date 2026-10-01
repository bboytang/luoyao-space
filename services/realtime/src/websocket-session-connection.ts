import type { RealtimeSessionConnection } from "./session-service";
import type {
  AudioFrame,
  RealtimeControlMessage,
  RealtimeServerMessage,
} from "../../../runtimes/realtime-device/src/protocol";
import { isControlMessage } from "../../../runtimes/realtime-device/src/protocol";
import { binaryAudioCodec } from "../../../runtimes/realtime-device/src/binary-audio-codec";

export interface ServerWebSocketLike {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message",
    listener: (event: { data: string | Uint8Array | ArrayBuffer }) => void,
  ): void;
  addEventListener(
    type: "close",
    listener: () => void,
  ): void;
}

export class WebSocketSessionConnection implements RealtimeSessionConnection {
  private readonly controlHandlers = new Set<
    (message: RealtimeControlMessage) => void | Promise<void>
  >();
  private readonly audioHandlers = new Set<
    (frame: AudioFrame) => void | Promise<void>
  >();
  private readonly closeHandlers = new Set<() => void | Promise<void>>();
  private closed = false;
  private controlTail: Promise<void> = Promise.resolve();

  constructor(private readonly socket: ServerWebSocketLike) {
    socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      this.closed = true;
      for (const handler of this.closeHandlers) void handler();
    });
  }

  async send(message: RealtimeServerMessage): Promise<void> {
    if (this.closed) return;
    this.socket.send(JSON.stringify(message));
  }

  async sendAudio(frame: AudioFrame): Promise<void> {
    if (this.closed) return;
    this.socket.send(binaryAudioCodec.encodeAudio(frame));
  }

  onControl(
    handler: (message: RealtimeControlMessage) => void | Promise<void>,
  ): () => void {
    this.controlHandlers.add(handler);
    return () => this.controlHandlers.delete(handler);
  }

  onAudio(handler: (frame: AudioFrame) => void | Promise<void>): () => void {
    this.audioHandlers.add(handler);
    return () => this.audioHandlers.delete(handler);
  }

  onClose(handler: () => void | Promise<void>): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  private async handleMessage(data: string | Uint8Array | ArrayBuffer): Promise<void> {
    try {
      if (typeof data === "string") {
        const value: unknown = JSON.parse(data);
        if (!isControlMessage(value)) {
          this.socket.close(1002, "Invalid control message");
          return;
        }
        const operation = this.controlTail.then(async () => {
          for (const handler of this.controlHandlers) await handler(value);
        });
        this.controlTail = operation;
        await operation;
        return;
      }

      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const frame = binaryAudioCodec.decodeAudio(bytes);
      for (const handler of this.audioHandlers) await handler(frame);
    } catch {
      this.socket.close(1002, "Invalid realtime message");
    }
  }
}
