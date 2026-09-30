import { describe, expect, it, vi } from "vitest";
import { AvatarRuntime } from "../../../runtimes/avatar/src/runtime";
import {
  BrowserWebSocket,
  RealtimeClient,
  type RealtimeClientSocket,
} from "./realtime-client";

class FakeSocket implements RealtimeClientSocket {
  readonly send = vi.fn<(data: string | Uint8Array) => void>();
  readonly close = vi.fn<(code?: number, reason?: string) => void>();
  private readonly handlers = {
    message: [] as Array<(event: { data: string | Uint8Array }) => void>,
    close: [] as Array<
      (event: { code: number; reason: string; wasClean: boolean }) => void
    >,
  };

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

  waitForOpen(): Promise<void> {
    return Promise.resolve();
  }

  receiveClose(code: number, reason: string, wasClean: boolean): void {
    for (const handler of this.handlers.close) {
      handler({ code, reason, wasClean });
    }
  }
}

function createClient() {
  const socket = new FakeSocket();
  const input = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const output = {
    play: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const avatar = new AvatarRuntime({ renderer: { render: vi.fn() } });

  const client = new RealtimeClient({
    url: "wss://example.test/realtime",
    socket,
    avatar,
    input,
    output,
  });

  return { client, socket, input, output };
}

describe("BrowserWebSocket", () => {
  it("exports a browser WebSocket adapter", () => {
    expect(BrowserWebSocket).toBeTypeOf("function");
  });
});

describe("RealtimeClient", () => {
  it("sends the hello message when connected", async () => {
    const { client, socket } = createClient();

    await client.connect();

    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"hello"'),
    );
  });

  it("makes close idempotent and rejects lifecycle operations afterwards", async () => {
    const { client, socket, input, output } = createClient();

    await client.close();
    await client.close();

    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledTimes(1);

    await expect(client.connect()).rejects.toThrow("RealtimeClient is closed");
    await expect(client.startListening()).rejects.toThrow("RealtimeClient is closed");
    await client.abort();

    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("does not send abort when close wins an in-flight abort", async () => {
    const socket = new FakeSocket();
    let releaseStop!: () => void;
    const stop = vi.fn(() => new Promise<void>((resolve) => {
      releaseStop = resolve;
    }));
    const input = {
      start: vi.fn().mockResolvedValue(undefined),
      stop,
    };
    const output = {
      play: vi.fn().mockResolvedValue(undefined),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const avatar = new AvatarRuntime({ renderer: { render: vi.fn() } });
    const client = new RealtimeClient({
      url: "wss://example.test/realtime",
      socket,
      avatar,
      input,
      output,
    });

    const abortPromise = client.abort();
    await Promise.resolve();
    const closePromise = client.close();
    releaseStop();

    await Promise.all([abortPromise, closePromise]);

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("ignores a transport close event after client close", async () => {
    const { client, socket, input, output } = createClient();

    await client.close();
    socket.receiveClose(1000, "client closed", true);

    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
  });
});
