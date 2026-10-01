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

  receiveMessage(data: string | Uint8Array): void {
    for (const handler of this.handlers.message) {
      handler({ data });
    }
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

  it("rejects when the browser socket closes before opening", async () => {
    const OriginalWebSocket = globalThis.WebSocket;
    let closeHandler!: () => void;

    class FakeBrowserWebSocket {
      static OPEN = 1;
      readyState = 0;

      addEventListener(
        type: "open" | "error" | "close",
        listener: () => void,
      ): void {
        if (type === "close") closeHandler = listener;
      }

      send(): void {}
      close(): void {}
    }

    vi.stubGlobal("WebSocket", FakeBrowserWebSocket);
    try {
      const socket = new BrowserWebSocket("wss://example.test/realtime");
      const promise = socket.waitForOpen();
      closeHandler();

      await expect(promise).rejects.toThrow("closed before opening");
    } finally {
      vi.stubGlobal("WebSocket", OriginalWebSocket);
    }
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

  it("interrupts the response without stopping microphone capture", async () => {
    const { client, socket, input, output } = createClient();

    await client.connect();
    await client.startListening();
    await client.interruptResponse();

    expect(input.stop).not.toHaveBeenCalled();
    expect(output.stop).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"abort"'),
    );
    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"barge_in"'),
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

  it("makes concurrent close calls wait for the same cleanup", async () => {
    const socket = new FakeSocket();
    let releaseStop!: () => void;
    const input = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(() => new Promise<void>((resolve) => {
        releaseStop = resolve;
      })),
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

    const firstClose = client.close();
    const secondClose = client.close();
    let secondFinished = false;
    void secondClose.then(() => {
      secondFinished = true;
    });

    await Promise.resolve();
    expect(secondFinished).toBe(false);

    releaseStop();
    await Promise.all([firstClose, secondClose]);

    expect(secondFinished).toBe(true);
    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("does not send hello when close wins while waiting for open", async () => {
    const socket = new FakeSocket();
    let releaseOpen!: () => void;
    socket.waitForOpen = () => new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
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

    const connectPromise = client.connect();
    await Promise.resolve();
    const closePromise = client.close();
    releaseOpen();

    await expect(connectPromise).rejects.toThrow("RealtimeClient is closed");
    await closePromise;
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

  it("does not report connected if the socket closes during hello", async () => {
    const states: string[] = [];
    const socket = new FakeSocket();
    socket.send.mockImplementation(() => {
      socket.receiveClose(1000, "server closed", true);
    });
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
      onStateChange: (state) => states.push(state),
    });

    await expect(client.connect()).rejects.toThrow("RealtimeClient is closed");
    expect(states).toEqual(["connecting", "closed"]);
    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
  });

  it("reports connection state transitions once", async () => {
    const states: string[] = [];
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
      onStateChange: (state) => states.push(state),
    });

    await client.connect();
    socket.receiveClose(1000, "server closed", true);
    await client.close();

    expect(states).toEqual(["connecting", "connected", "closed"]);
  });

  it("treats a remote socket close as a terminal lifecycle state", async () => {
    const { client, socket, input, output } = createClient();

    await client.connect();
    socket.receiveClose(1006, "network lost", false);

    await expect(client.connect()).rejects.toThrow("RealtimeClient is closed");
    await client.startListening().catch((error: unknown) => {
      expect(error).toEqual(new Error("RealtimeClient is closed"));
    });

    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
  });

  it("contains rejected cleanup promises from transport close callbacks", async () => {
    const { client, socket, input, output } = createClient();
    input.stop.mockRejectedValue(new Error("input stop failed"));
    output.stop.mockRejectedValue(new Error("output stop failed"));

    await client.close();
    socket.receiveClose(1000, "server closed", true);
    await Promise.resolve();

    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
  });

  it("contains rejected playback-idle promises", async () => {
    const { client, socket, output } = createClient();
    output.waitForIdle.mockRejectedValue(new Error("idle failed"));

    await client.connect();
    socket.receiveMessage(JSON.stringify({
      type: "tts",
      state: "stop",
    }));
    await Promise.resolve();

    expect(output.waitForIdle).toHaveBeenCalledTimes(1);
  });

  it("ignores a transport close event after client close", async () => {
    const { client, socket, input, output } = createClient();

    await client.close();
    socket.receiveClose(1000, "client closed", true);

    expect(input.stop).toHaveBeenCalledTimes(1);
    expect(output.stop).toHaveBeenCalledTimes(1);
  });
});
