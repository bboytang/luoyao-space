import { describe, expect, it } from "vitest";
import { authorize } from "./permissions";

describe("tool permissions", () => {
  it("requires autonomy appropriate to the risk", () => {
    expect(
      authorize("L2", ["filesystem.write"], {
        autonomy: 1,
        grantedPermissions: ["filesystem.write"],
        deviceId: "desktop-1",
        devicePermissions: {
          "desktop-1": ["filesystem.write"],
        },
        approvalGranted: true,
      }).allowed,
    ).toBe(false);
  });

  it("does not leak permissions between devices", () => {
    const context = {
      autonomy: 2 as const,
      grantedPermissions: [],
      deviceId: "iphone-1",
      devicePermissions: {
        "desktop-1": ["filesystem.write"],
        "iphone-1": [],
      },
      approvalGranted: true,
    };

    expect(authorize("L2", ["filesystem.write"], context)).toEqual({
      allowed: false,
      reason: "missing_permission:filesystem.write",
    });
  });

  it("combines global permissions with permissions for the target device", () => {
    expect(
      authorize("L2", ["github.read", "filesystem.write"], {
        autonomy: 2,
        grantedPermissions: ["github.read"],
        deviceId: "desktop-1",
        devicePermissions: {
          "desktop-1": ["filesystem.write"],
        },
        approvalGranted: true,
      }).allowed,
    ).toBe(true);
  });
});
