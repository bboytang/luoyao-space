import { describe, expect, it } from "vitest";
import type { AudioFrame } from "../../../runtimes/realtime-device/src/protocol";
import type { ServerWebSocketLike } from "./websocket-session-connection";
import { WebSocketSessionConnection } from "./websocket-session-connection";

class FakeSocket implements ServerWebSocketLike {
  readonly sent: Array<string | Uint8Array> = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private messageHandlers: Array<(event: { data: string | Uint8Array | ArrayBuffer }) => void> = [];
  private closeHandlers: Array<() => void> = [];

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    for (const handler of this.closeHandlers) handler();
  }

  addEventListener(type: "message" | "close", listener: ((event: { data: string | Uint8Array | ArrayBuffer }) => void) | (() => void)): void {
    if (type === "message") this.messageHandlers.push(listener as (event: { data: string | Uint8Array | ArrayBuffer }) => void);
    else this.closeHandlers.push(listener as () => void);
  }

  async receive(data: string | Uint8Array): Promise<void> {
    for (const handler of this.messageHandlers) handler({ data });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

const frame: AudioFrame = {
  kind: "audio",
  codec: "pcm_s16le",
  sampleRate: 24_000,
  channels: 1,
  sequence: 3,
  payload: new Uint8Array([1, 2, 3, 4]),
};

describe("WebSocketSessionConnection", () => {
  it("decodes client control and audio messages", async () => {
    const socket = new FakeSocket();
    const connection = new WebSocketSessionConnection(socket);
    const controls: unknown[] = [];
    const audio: AudioFrame[] = [];

    connection.onControl((message) => { controls.push(message); });
    connection.onAudio((value) => { audio.push(value); });

    await socket.receive(JSON.stringify({
      type: "hello",
      version: 1,
      sessionId: "session-1",
    }));

    const encoded = (await import("../../../runtimes/realtime-device/src/binary-audio-codec")).binaryAudioCodec.encodeAudio(frame);
    await socket.receive(encoded);

    expect(controls).toEqual([{
      type: "hello",
      version: 1,
      sessionId: "session-1",
    }]);
    expect(audio).toEqual([frame]);
  });

  it("serializes concurrent control messages in arrival order", async () => {
    const socket = new FakeSocket();
    const connection = new WebSocketSessionConnection(socket);
    let releaseFirst!: () => void;
    const seen: string[] = [];

    connection.onControl(async (message) => {
      seen.push(message.type);
      if (message.type === "hello") {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
    });

    const first = socket.receive(JSON.stringify({
      type: "hello",
      version: 1,
      sessionId: "session-1",
    }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const second = socket.receive(JSON.stringify({
      type: "ping",
      timestamp: 1,
    }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual(["hello"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(seen).toEqual(["hello", "ping"]);
  });

  it("encodes server control and audio messages", async () => {
    const socket = new FakeSocket();
    const connection = new WebSocketSessionConnection(socket);

    await connection.send({
      type: "ready",
      sessionId: "session-1",
      state: "ready",
      serverTime: "2026-01-01T00:00:00.000Z",
    });
    await connection.sendAudio(frame);

    expect(socket.sent[0]).toBe(JSON.stringify({
      type: "ready",
      sessionId: "session-1",
      state: "ready",
      serverTime: "2026-01-01T00:00:00.000Z",
    }));
    expect(socket.sent[1]).toBeInstanceOf(Uint8Array);
  });

  it("closes with protocol error for invalid messages", async () => {
    const socket = new FakeSocket();
    new WebSocketSessionConnection(socket);

    await socket.receive(JSON.stringify({ type: "unknown" }));

    expect(socket.closes).toEqual([{ code: 1002, reason: "Invalid control message" }]);
  });
});
