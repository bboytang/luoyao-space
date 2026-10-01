import { describe, expect, it, vi } from "vitest";
import type {
  AudioFrame,
  RealtimeControlMessage,
  RealtimeServerMessage,
} from "./protocol";
import { WebSocketTransport, type WebSocketLike } from "./websocket-transport";
import type { TransportCodec } from "./transport";
import { binaryAudioCodec } from "./binary-audio-codec";

class FakeSocket implements WebSocketLike {
  waitForOpen(): Promise<void> {
    return Promise.resolve();
  }

  private readonly handlers = {
    message: [] as Array<(event: { data: string | Uint8Array }) => void>,
    close: [] as Array<
      (event: { code: number; reason: string; wasClean: boolean }) => void
    >,
  };

  readonly send = vi.fn<(data: string | Uint8Array) => void>();
  readonly close = vi.fn<(code?: number, reason?: string) => void>();

  addEventListener(
    type: "message" | "close",
    listener:
      | ((event: { data: string | Uint8Array }) => void)
      | ((event: { code: number; reason: string; wasClean: boolean }) => void),
  ): void {
    if (type === "message") {
      this.handlers.message.push(
        listener as (event: { data: string | Uint8Array }) => void,
      );
    } else {
      this.handlers.close.push(
        listener as (event: {
          code: number;
          reason: string;
          wasClean: boolean;
        }) => void,
      );
    }
  }

  receiveMessage(data: string | Uint8Array): void {
    for (const handler of this.handlers.message) handler({ data });
  }

  receiveClose(code: number, reason: string, wasClean: boolean): void {
    for (const handler of this.handlers.close) {
      handler({ code, reason, wasClean });
    }
  }
}

const codec: TransportCodec = {
  decodeControl: (data) => JSON.parse(data) as RealtimeServerMessage,
  encodeControl: (message) => JSON.stringify(message),
  decodeAudio: (data) => ({
    kind: "audio",
    codec: "opus",
    sampleRate: 16_000,
    channels: 1,
    sequence: data[0] ?? 0,
    payload: data,
  }),
  encodeAudio: (frame) => frame.payload,
};

describe("WebSocketTransport", () => {
  it("encodes outbound control and audio messages", async () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport(socket, codec);

    const message: RealtimeControlMessage = {
      type: "ping",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    const frame: AudioFrame = {
      kind: "audio",
      codec: "opus",
      sampleRate: 16_000,
      channels: 1,
      sequence: 7,
      payload: new Uint8Array([7, 8]),
    };

    await transport.send(message);
    await transport.sendAudio(frame);
    await transport.close(1000, "done");

    expect(socket.send).toHaveBeenNthCalledWith(1, JSON.stringify(message));
    expect(socket.send).toHaveBeenNthCalledWith(2, frame.payload);
    expect(socket.close).toHaveBeenCalledWith(1000, "done");
  });

  it("routes v2 admission separately from realtime voice messages", async () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport(socket, codec);
    const admissions: string[] = [];
    const voiceMessages: string[] = [];
    transport.onDeviceSession((outcome) => { admissions.push(outcome.type); });
    transport.onMessage((message) => { voiceMessages.push(message.type); });
    const hello = {
      type: "device.hello" as const, protocolVersions: [2],
      device: { deviceId: "iot-1", platform: "iot" as const },
      supportedCapabilities: [], availableCapabilities: [],
    };
    await transport.sendDeviceHello(hello);
    socket.receiveMessage(JSON.stringify({
      type: "device.accepted", version: 2, transportSessionId: "t-1",
      ownerConnectionId: "c-1", negotiatedCapabilities: [],
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify(hello));
    expect(admissions).toEqual(["device.accepted"]);
    expect(voiceMessages).toEqual([]);
  });

  it("decodes a real v2 admission response through the production codec", async () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport(socket, binaryAudioCodec);
    const outcomes: string[] = [];
    transport.onDeviceSession((outcome) => { outcomes.push(outcome.type); });
    socket.receiveMessage(JSON.stringify({
      type: "device.rejected", reason: "unsupported_version", supportedVersions: [2],
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcomes).toEqual(["device.rejected"]);
  });

  it("decodes inbound control and audio messages", async () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport(socket, codec);
    const onMessage = vi.fn();
    const onAudio = vi.fn();

    transport.onMessage(onMessage);
    transport.onAudio(onAudio);

    const ready: RealtimeServerMessage = {
      type: "ready",
      sessionId: "session-1",
      state: "ready",
      serverTime: "2026-01-01T00:00:00.000Z",
    };
    socket.receiveMessage(JSON.stringify(ready));
    socket.receiveMessage(new Uint8Array([9, 10]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onMessage).toHaveBeenCalledWith(ready);
    expect(onAudio).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 9, payload: new Uint8Array([9, 10]) }),
    );
  });


  it("closes with a protocol error when inbound decoding fails", () => {
    const socket = new FakeSocket();
    const failingCodec: TransportCodec = {
      ...codec,
      decodeControl: () => {
        throw new Error("malformed");
      },
    };
    new WebSocketTransport(socket, failingCodec);

    socket.receiveMessage("not-json");

    expect(socket.close).toHaveBeenCalledWith(1002, "protocol error");
  });

  it("contains inbound handler failures", async () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport(socket, codec);
    transport.onMessage(() => {
      throw new Error("handler failed");
    });

    socket.receiveMessage(
      JSON.stringify({
        type: "ping",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socket.close).toHaveBeenCalledWith(1011, "message handler failed");
  });

  it("maps close events and supports unsubscribe", () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport(socket, codec);
    const onClose = vi.fn();
    const onMessage = vi.fn();

    const removeClose = transport.onClose(onClose);
    const removeMessage = transport.onMessage(onMessage);
    removeClose();
    removeMessage();

    socket.receiveClose(1000, "normal", true);
    socket.receiveMessage(
      JSON.stringify({
        type: "ping",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(onClose).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });
});
