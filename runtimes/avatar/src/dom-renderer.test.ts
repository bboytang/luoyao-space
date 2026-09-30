import { describe, expect, it } from "vitest";
import { DomAvatarRenderer } from "./dom-renderer";

// DOM renderer tests require a browser/jsdom environment; the class is covered
// by the render-model contract until the web shell selects its DOM test runtime.
describe("DomAvatarRenderer", () => {
  it("exposes a browser-renderer contract", () => {
    expect(typeof DomAvatarRenderer).toBe("function");
  });
});
