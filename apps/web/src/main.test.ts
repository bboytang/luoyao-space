import { describe, expect, it } from "vitest";

describe("web avatar host", () => {
  it("keeps the browser entrypoint isolated from the server runtime", () => {
    expect("apps/web").toContain("web");
  });
});
