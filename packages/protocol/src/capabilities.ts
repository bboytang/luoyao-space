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
