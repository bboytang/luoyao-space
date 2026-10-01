import { timingSafeEqual } from "node:crypto";
import type { RealtimeConfig } from "./config";
import type { RealtimeAdmissionProviders } from "./connection-factory";

export interface PhysicalDevelopmentConnectionContext {
  readonly headers: { readonly authorization?: string };
}

/** Development-only handshake credential. The v2 hello never carries this secret. */
export function createPhysicalDevelopmentProviders(
  identity: NonNullable<RealtimeConfig["physicalDevelopment"]>,
): RealtimeAdmissionProviders<PhysicalDevelopmentConnectionContext> {
  const expected = Buffer.from(identity.token, "hex");
  return {
    principalProvider: {
      async resolve(request) {
        const header = request.headers.authorization;
        if (typeof header !== "string" || !/^Bearer [0-9a-f]{64}$/.test(header)) return null;
        const presented = Buffer.from(header.slice(7), "hex");
        return timingSafeEqual(presented, expected) ? { userId: identity.userId } : null;
      },
    },
    deviceAuthorizer: {
      async findAuthorizedDevice(principal, deviceId) {
        return principal.userId === identity.userId && deviceId === identity.deviceId
          ? { userId: identity.userId, deviceId: identity.deviceId }
          : null;
      },
    },
  };
}
