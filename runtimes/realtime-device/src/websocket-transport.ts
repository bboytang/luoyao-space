import type {
  AudioFrame,
  RealtimeControlMessage,
  RealtimeServerMessage,
} from "./protocol";
import type {
  RealtimeTransport,
  TransportCloseEvent,
  TransportCodec,
} from "./transport";

export interface WebSocketLike {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message",
    listener: (event: { data: string | Uint8Array }) => void,
  ): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string; wasClean: boolean }) => void,
  ): void;
}

export class WebSocketTransport implements RealtimeTransport {
  private readonly messageHandlers = new Set<
    (message: RealtimeControlMessage) => void | Promise<void>
  >();
  private readonly audioHandlers = new Set<
    (frame: AudioFrame) => void | Promise<void>
  >();
  private readonly closeHandlers = new Set<
    (event: TransportCloseEvent) => void
  >();

  constructor(
    private readonly socket: WebSocketLike,
    private readonly codec: TransportCodec,
  ) {
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        const message = this.codec.decodeControl(event.data);
        for (const handler of this.messageHandlers) {
          void handler(message);
        }
        return;
      }

      const frame = this.codec.decodeAudio(event.data);
      for (const handler of this.audioHandlers) {
        void handler(frame);
      }
    });

    socket.addEventListener("close", (event) => {
      const closeEvent: TransportCloseEvent = {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      };
      for (const handler of this.closeHandlers) {
        handler(closeEvent);
      }
    });
  }

  async send(message: RealtimeServerMessage): Promise<void> {
    this.socket.send(this.codec.encodeControl(message));
  }

  async sendAudio(frame: AudioFrame): Promise<void> {
    this.socket.send(this.codec.encodeAudio(frame));
  }

  async close(code?: number, reason?: string): Promise<void> {
    this.socket.close(code, reason);
  }

  onMessage(
    handler: (message: RealtimeControlMessage) => void | Promise<void>,
  ): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onAudio(
    handler: (frame: AudioFrame) => void | Promise<void>,
  ): () => void {
    this.audioHandlers.add(handler);
    return () => this.audioHandlers.delete(handler);
  }

  onClose(handler: (event: TransportCloseEvent) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
}
