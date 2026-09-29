import { describe, expect, it } from "vitest";
import { DefaultModelRouter, ModelRoutingError, type ModelProvider } from "./model-router";

function provider(id: string, supports: readonly ("fast_chat" | "reasoning")[]): ModelProvider {
  return {
    id,
    supports,
    async generate(input) {
      return { text: String(input.input), providerId: id };
    },
  };
}

describe("DefaultModelRouter", () => {
  it("uses the configured provider when it supports the requested class", () => {
    const router = new DefaultModelRouter(
      [provider("primary", ["fast_chat"]), provider("backup", ["fast_chat"])],
      { fast_chat: "primary" },
    );

    expect(router.route({ modelClass: "fast_chat" })).toEqual({
      providerId: "primary",
      modelClass: "fast_chat",
    });
  });

  it("falls back to an available provider when the preferred provider is unavailable", () => {
    const router = new DefaultModelRouter(
      [provider("backup", ["fast_chat"])],
      { fast_chat: "primary" },
    );

    expect(router.route({ modelClass: "fast_chat" }).providerId).toBe("backup");
  });

  it("rejects when no provider supports the requested class", () => {
    const router = new DefaultModelRouter(
      [provider("chat", ["fast_chat"])],
      {},
    );

    expect(() => router.route({ modelClass: "reasoning" })).toThrow(ModelRoutingError);
  });

  it("generates through the selected provider", async () => {
    const router = new DefaultModelRouter(
      [provider("primary", ["fast_chat"])],
      { fast_chat: "primary" },
    );

    await expect(
      router.generate({ modelClass: "fast_chat", input: "hello" }),
    ).resolves.toEqual({
      text: "hello",
      providerId: "primary",
    });
  });
});
