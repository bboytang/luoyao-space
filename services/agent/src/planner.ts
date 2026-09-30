import type { CapabilityDefinition, RiskLevel } from "../../../packages/protocol/src/capabilities";
import type { TaskPlanStep } from "../../../packages/protocol/src/tasks";

export type PlanStep = TaskPlanStep;

export interface AgentPlan {
  goal: string;
  steps: PlanStep[];
  requiresApproval: boolean;
}

export interface PlannerStepRequest {
  capabilityId: string;
  description: string;
  input: unknown;
}

export interface PlannerRequest {
  goal: string;
  steps: PlannerStepRequest[];
}

export interface CapabilityRegistry {
  get(capabilityId: string): CapabilityDefinition | undefined;
}

const riskOrder: Record<RiskLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

export function createAgentPlan(request: PlannerRequest, registry: CapabilityRegistry): AgentPlan {
  const goal = request.goal.trim();
  if (!goal) throw new Error("Planner goal must not be empty");
  if (request.steps.length === 0) throw new Error("Planner must contain at least one step");

  const steps = request.steps.map((step, index) => {
    const capability = registry.get(step.capabilityId);
    if (!capability) throw new Error("Unknown capability: " + step.capabilityId);

    const description = step.description.trim();
    if (!description) throw new Error("Planner step description must not be empty");

    return {
      id: "step-" + (index + 1),
      capabilityId: capability.id,
      description,
      risk: capability.risk,
      requiredPermissions: [...capability.requiredPermissions],
      requiresApproval: capability.risk === "L3" || capability.risk === "L2",
      input: step.input,
    };
  });

  return { goal, steps, requiresApproval: steps.some((step) => step.requiresApproval) };
}

export function highestPlanRisk(plan: AgentPlan): RiskLevel {
  return plan.steps.reduce<RiskLevel>(
    (highest, step) => riskOrder[step.risk] > riskOrder[highest] ? step.risk : highest,
    "L0",
  );
}
