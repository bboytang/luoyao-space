import type {
  RealtimeControlMessage,
  RealtimeSessionState,
} from "./protocol";

export type SessionTransition =
  | { type: "hello" }
  | { type: "listen_start" }
  | { type: "listen_stop" }
  | { type: "processing" }
  | { type: "speech_start" }
  | { type: "speech_stop" }
  | { type: "abort" }
  | { type: "close" }
  | { type: "closed" };

const transitions: Record<
  RealtimeSessionState,
  Partial<Record<SessionTransition["type"], RealtimeSessionState>>
> = {
  connecting: {
    hello: "ready",
    close: "closing",
  },
  ready: {
    listen_start: "listening",
    close: "closing",
  },
  listening: {
    listen_stop: "processing",
    abort: "aborting",
    close: "closing",
  },
  processing: {
    speech_start: "speaking",
    abort: "aborting",
    close: "closing",
  },
  speaking: {
    speech_stop: "ready",
    abort: "aborting",
    close: "closing",
  },
  aborting: {
    closed: "closed",
    listen_start: "listening",
    close: "closing",
  },
  closing: {
    closed: "closed",
  },
  closed: {},
};

export class InvalidSessionTransitionError extends Error {
  constructor(
    public readonly state: RealtimeSessionState,
    public readonly event: SessionTransition["type"],
  ) {
    super(`Invalid realtime session transition: ${state} + ${event}`);
    this.name = "InvalidSessionTransitionError";
  }
}

export class RealtimeSession {
  private _state: RealtimeSessionState = "connecting";

  constructor(
    public readonly sessionId: string,
    public readonly deviceId?: string,
  ) {}

  get state(): RealtimeSessionState {
    return this._state;
  }

  transition(event: SessionTransition["type"]): RealtimeSessionState {
    const next = transitions[this._state][event];

    if (!next) {
      throw new InvalidSessionTransitionError(this._state, event);
    }

    this._state = next;
    return next;
  }

  handleControl(message: RealtimeControlMessage): RealtimeSessionState {
    switch (message.type) {
      case "hello":
        return this.transition("hello");
      case "listen":
        return this.transition(message.mode === "start" ? "listen_start" : "listen_stop");
      case "abort":
        return this.transition("abort");
      case "ping":
        return this._state;
    }
  }
}
