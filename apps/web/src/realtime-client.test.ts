import { describe, expect, it } from "vitest";
import { BrowserWebSocket } from "./realtime-client";

describe("BrowserWebSocket", () => {
  it("exports a browser WebSocket adapter", () => {
    expect(BrowserWebSocket).toBeTypeOf("function");
  });
});
