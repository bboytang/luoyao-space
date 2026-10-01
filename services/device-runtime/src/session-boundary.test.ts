import { describe, expect, it } from "vitest";
import { InMemoryDeviceSessionOwnership } from "./session-boundary";

describe("device session ownership boundary", () => {
  it("atomically rejects a second active owner of the same transport session", () => {
    const ownership = new InMemoryDeviceSessionOwnership();
    expect(ownership.acquire("session-1", "connection-1")).toBe("acquired");
    expect(ownership.acquire("session-1", "connection-2")).toBe("ownership_conflict");
    expect(ownership.get("session-1")).toEqual({
      transportSessionId: "session-1", connectionId: "connection-1", state: "active",
    });
  });

  it("ends ownership only for the owning connection and never resumes an ended transport session", () => {
    const ownership = new InMemoryDeviceSessionOwnership();
    ownership.acquire("session-1", "connection-1");
    ownership.release("session-1", "connection-2");
    expect(ownership.get("session-1")?.state).toBe("active");
    ownership.release("session-1", "connection-1");
    expect(ownership.get("session-1")?.state).toBe("ended");
    expect(ownership.acquire("session-1", "connection-1")).toBe("transport_session_ended");
    expect(ownership.acquire("session-2", "connection-2")).toBe("acquired");
  });
});
