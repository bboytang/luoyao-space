import type {
  AudioFrame,
  RealtimeControlMessage,
  RealtimeServerMessage,
} from "./protocol";
import type {
  DeviceSessionTransport,
  TransportCloseEvent,
} from "./transport";
import type { DeviceSessionHelloV2, DeviceSessionOutcomeV2 } from "../../../packages/protocol/src/device-session";

type MessageHandler = (
  message: RealtimeServerMessage,
) => void | Promise<void>;

type AudioHandler = (frame: AudioFrame) => void | Promise<void>;

type CloseHandler = (event: TransportCloseEvent) => void;

export class MemoryRealtimeTransport implements DeviceSessionTransport {
  async waitUntilReady(): Promise<void> {
    this.assertOpen();
  }

  readonly sentMessages: RealtimeControlMessage[] = [];
  readonly sentAudio: AudioFrame[] = [];
  readonly sentDeviceHellos: DeviceSessionHelloV2[] = [];

  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly audioHandlers = new Set<AudioHandler>();
  private readonly closeHandlers = new Set<CloseHandler>();
  private readonly deviceSessionHandlers = new Set<(outcome: DeviceSessionOutcomeV2) => void | Promise<void>>();
  private closed = false;

  async send(message: RealtimeControlMessage): Promise<void> {
    this.assertOpen();
    this.sentMessages.push(message);
  }

  async sendAudio(frame: AudioFrame): Promise<void> {
    this.assertOpen();
    this.sentAudio.push(frame);
  }

  async sendDeviceHello(hello: DeviceSessionHelloV2): Promise<void> {
    this.assertOpen();
    this.sentDeviceHellos.push(hello);
  }

  onDeviceSession(handler: (outcome: DeviceSessionOutcomeV2) => void | Promise<void>): () => void {
    this.deviceSessionHandlers.add(handler);
    return () => this.deviceSessionHandlers.delete(handler);
  }

  async receiveDeviceSession(outcome: DeviceSessionOutcomeV2): Promise<void> {
    this.assertOpen();
    for (const handler of this.deviceSessionHandlers) await handler(outcome);
  }

  async close(code = 1000, reason = ""): Promise<void> {
    if (this.closed) return;

    this.closed = true;

    const event: TransportCloseEvent = {
      code,
      reason,
      wasClean: code === 1000,
    };

    for (const handler of this.closeHandlers) {
      handler(event);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onAudio(handler: AudioHandler): () => void {
    this.audioHandlers.add(handler);
    return () => this.audioHandlers.delete(handler);
  }

  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  async receiveMessage(message: RealtimeServerMessage): Promise<void> {
    this.assertOpen();

    for (const handler of this.messageHandlers) {
      await handler(message);
    }
  }

  async receiveAudio(frame: AudioFrame): Promise<void> {
    this.assertOpen();

    for (const handler of this.audioHandlers) {
      await handler(frame);
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Realtime transport is closed");
    }
  }
}
