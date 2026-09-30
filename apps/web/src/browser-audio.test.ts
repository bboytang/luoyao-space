import { describe, expect, it } from "vitest";
import { BrowserPcmCapture, BrowserPcmPlayback } from "./browser-audio";

describe("browser audio adapters", () => {
  it("exposes separate capture and playback adapters", () => {
    expect(new BrowserPcmCapture()).toBeInstanceOf(BrowserPcmCapture);
    expect(new BrowserPcmPlayback()).toBeInstanceOf(BrowserPcmPlayback);
  });
});
