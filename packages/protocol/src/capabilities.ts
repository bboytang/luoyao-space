export type RiskLevel = "L0" | "L1" | "L2" | "L3";

export interface CapabilityDefinition<Input = unknown, Output = unknown> {
  id: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  risk: RiskLevel;
  requiredPermissions: string[];
  supportedRuntimes: string[];
}

export interface CapabilityInvocation<Input = unknown> {
  id: string;
  capabilityId: string;
  userId: string;
  deviceId?: string;
  input: Input;
  requestedBy: "agent" | "user" | "system";
}

export interface CapabilityResult<Output = unknown> {
  invocationId: string;
  ok: boolean;
  output?: Output;
  error?: {
    code: string;
    message: string;
  };
}


import type { DeviceIdentity } from "./identity";

export function isCapabilitySupportedOnDevice(
  capability: CapabilityDefinition,
  device: DeviceIdentity,
): boolean {
  return capability.supportedRuntimes.includes(device.runtime);
}


export function isInvocationBoundToUserDevice(
  invocation: CapabilityInvocation,
  device?: DeviceIdentity,
): boolean {
  if (!device) {
    return invocation.deviceId === undefined;
  }

  return (
    invocation.userId === device.userId &&
    (invocation.deviceId === undefined || invocation.deviceId === device.deviceId)
  );
}
