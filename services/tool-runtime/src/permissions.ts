import type { RiskLevel } from "../../../packages/protocol/src/capabilities";

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

const minimumAutonomy: Record<RiskLevel, AutonomyLevel> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

export interface PermissionContext {
  autonomy: AutonomyLevel;
  grantedPermissions: string[];
  devicePermissions: string[];
  approvalGranted: boolean;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
}

export function authorize(
  risk: RiskLevel,
  requiredPermissions: string[],
  context: PermissionContext,
): PermissionDecision {
  if (context.autonomy < minimumAutonomy[risk]) {
    return { allowed: false, reason: "autonomy_level_too_low" };
  }

  if (risk === "L3" && !context.approvalGranted) {
    return { allowed: false, reason: "explicit_approval_required" };
  }

  const granted = new Set([
    ...context.grantedPermissions,
    ...context.devicePermissions,
  ]);

  const missing = requiredPermissions.filter((permission) => !granted.has(permission));
  if (missing.length > 0) {
    return { allowed: false, reason: `missing_permission:${missing.join(",")}` };
  }

  return { allowed: true, reason: "authorized" };
}
