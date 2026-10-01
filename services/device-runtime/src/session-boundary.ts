import type {
  AuthorizedDeviceIdentity,
  TransportSessionOwner,
  TrustedPrincipal,
} from "../../../packages/protocol/src/device-session";

// The provider, not a client hello, establishes the principal from its connection context.
export interface TrustedPrincipalProvider<ConnectionContext> {
  resolve(context: ConnectionContext): Promise<TrustedPrincipal | null>;
}

export interface DeviceAuthorizationProvider {
  findAuthorizedDevice(principal: TrustedPrincipal, deviceId: string): Promise<AuthorizedDeviceIdentity | null>;
}

export type OwnershipAcquisition = "acquired" | "ownership_conflict" | "transport_session_ended";

export interface DeviceSessionOwnership {
  acquire(transportSessionId: string, connectionId: string): OwnershipAcquisition;
  release(transportSessionId: string, connectionId: string): void;
  get(transportSessionId: string): TransportSessionOwner | undefined;
}

// Single-process implementation. A deployment with multiple realtime processes needs a shared atomic store.
export class InMemoryDeviceSessionOwnership implements DeviceSessionOwnership {
  private readonly owners = new Map<string, TransportSessionOwner>();

  acquire(transportSessionId: string, connectionId: string): OwnershipAcquisition {
    const existing = this.owners.get(transportSessionId);
    if (existing?.state === "ended") return "transport_session_ended";
    if (existing) return "ownership_conflict";
    this.owners.set(transportSessionId, { transportSessionId, connectionId, state: "active" });
    return "acquired";
  }

  release(transportSessionId: string, connectionId: string): void {
    const existing = this.owners.get(transportSessionId);
    if (existing?.connectionId === connectionId && existing.state === "active") {
      this.owners.set(transportSessionId, { ...existing, state: "ended" });
    }
  }

  get(transportSessionId: string): TransportSessionOwner | undefined {
    return this.owners.get(transportSessionId);
  }
}
