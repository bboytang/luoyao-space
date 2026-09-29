import type {
  CapabilityDefinition,
  CapabilityInvocation,
  CapabilityResult,
} from "../../../packages/protocol/src/capabilities";
import type { DeviceIdentity } from "../../../packages/protocol/src/identity";
import { checkExecutionGate, type ExecutionGateContext } from "./execution-gate";

export interface CapabilityBackend<Input = unknown, Output = unknown> {
  execute(
    invocation: CapabilityInvocation<Input>,
  ): Promise<Output>;
}

export interface ToolExecutionContext extends ExecutionGateContext {
  backend: CapabilityBackend;
}

export async function executeCapability(
  capability: CapabilityDefinition,
  invocation: CapabilityInvocation,
  context: ToolExecutionContext,
): Promise<CapabilityResult> {
  const gate = checkExecutionGate(capability, invocation, context);

  if (!gate.allowed) {
    return {
      invocationId: invocation.id,
      ok: false,
      error: {
        code: "EXECUTION_DENIED",
        message: gate.reason,
      },
    };
  }

  try {
    const output = await context.backend.execute(invocation);
    return {
      invocationId: invocation.id,
      ok: true,
      output,
    };
  } catch (error) {
    return {
      invocationId: invocation.id,
      ok: false,
      error: {
        code: "BACKEND_EXECUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
