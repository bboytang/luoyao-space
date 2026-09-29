import type {
  CapabilityDefinition,
  CapabilityInvocation,
} from "../../../packages/protocol/src/capabilities";
import type { DeviceIdentity } from "../../../packages/protocol/src/identity";
import {
  isCapabilitySupportedOnDevice,
  isInvocationBoundToUserDevice,
} from "../../../packages/protocol/src/capabilities";
import {
  authorize,
  type PermissionContext,
} from "./permissions";

export type ExecutionGateDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface ExecutionGateContext {
  device: DeviceIdentity;
  permission: PermissionContext;
}

export function checkExecutionGate(
  capability: CapabilityDefinition,
  invocation: CapabilityInvocation,
  context: ExecutionGateContext,
): ExecutionGateDecision {
  if (invocation.userId !== context.device.userId) {
    return { allowed: false, reason: "user_identity_mismatch" };
  }

  if (!isInvocationBoundToUserDevice(invocation, context.device)) {
    return { allowed: false, reason: "device_identity_mismatch" };
  }

  if (!isCapabilitySupportedOnDevice(capability, context.device)) {
    return { allowed: false, reason: "runtime_not_supported" };
  }

  const permission = authorize(
    capability.risk,
    capability.requiredPermissions,
    context.permission,
  );

  if (!permission.allowed) {
    return permission;
  }

  return { allowed: true };
}
