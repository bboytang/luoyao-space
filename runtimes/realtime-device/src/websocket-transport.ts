import type {
  AudioFrame,
  RealtimeControlMessage,
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
      try {
        if (typeof event.data === "string") {
          const message = this.codec.decodeControl(event.data);
          for (const handler of this.messageHandlers) {
            void Promise.resolve()
              .then(() => handler(message))
              .catch(() => this.protocolClose(1011, "message handler failed"));
          }
          return;
        }

        const frame = this.codec.decodeAudio(event.data);
        for (const handler of this.audioHandlers) {
          void Promise.resolve()
            .then(() => handler(frame))
            .catch(() => this.protocolClose(1011, "audio handler failed"));
        }
      } catch {
        this.protocolClose(1002, "protocol error");
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

  private protocolClose(code: number, reason: string): void {
    try {
      this.socket.close(code, reason);
    } catch {
      // The socket may already be closing or closed.
    }
  }

  async send(message: RealtimeControlMessage): Promise<void> {
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
