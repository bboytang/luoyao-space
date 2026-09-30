import { describe, expect, it } from "vitest";
import { createAgentPlan, highestPlanRisk } from "./planner";
import type { CapabilityDefinition } from "../../../packages/protocol/src/capabilities";

const capabilities: CapabilityDefinition[] = [
  { id: "browser.open", description: "Open a page", inputSchema: {}, outputSchema: {}, risk: "L1", requiredPermissions: ["browser.read"], supportedRuntimes: ["browser"] },
  { id: "filesystem.write", description: "Write a file", inputSchema: {}, outputSchema: {}, risk: "L2", requiredPermissions: ["filesystem.write"], supportedRuntimes: ["desktop"] },
  { id: "account.change_credentials", description: "Change account credentials", inputSchema: {}, outputSchema: {}, risk: "L3", requiredPermissions: ["account.security"], supportedRuntimes: ["desktop"] },
];

const registry = { get(id: string) { return capabilities.find((capability) => capability.id === id); } };

describe("agent planner", () => {
  it("builds a validated plan without executing capabilities", () => {
    const plan = createAgentPlan({
      goal: "整理项目文件",
      steps: [{ capabilityId: "browser.open", description: "打开项目页面", input: { url: "https://example.com" } }],
    }, registry);

    expect(plan.goal).toBe("整理项目文件");
    expect(plan.steps[0]).toMatchObject({ id: "step-1", capabilityId: "browser.open", risk: "L1", requiresApproval: false });
    expect(plan.requiresApproval).toBe(false);
  });

  it("requires approval for consequential and high-impact capabilities", () => {
    const plan = createAgentPlan({
      goal: "修改项目",
      steps: [
        { capabilityId: "filesystem.write", description: "写入文件", input: { path: "README.md" } },
        { capabilityId: "account.change_credentials", description: "修改凭据", input: {} },
      ],
    }, registry);

    expect(plan.requiresApproval).toBe(true);
    expect(plan.steps.map((step) => step.requiresApproval)).toEqual([true, true]);
    expect(highestPlanRisk(plan)).toBe("L3");
  });

  it("rejects unknown capabilities before creating a plan", () => {
    expect(() => createAgentPlan({ goal: "执行未知操作", steps: [{ capabilityId: "unknown.capability", description: "未知", input: {} }] }, registry)).toThrow("Unknown capability: unknown.capability");
  });

  it("rejects an empty goal", () => {
    expect(() => createAgentPlan({ goal: "  ", steps: [] }, registry)).toThrow("Planner goal must not be empty");
  });

  it("rejects a plan with no executable steps", () => {
    expect(() => createAgentPlan({ goal: "没有步骤", steps: [] }, registry)).toThrow("Planner must contain at least one step");
  });

  it("rejects an empty step description", () => {
    expect(() => createAgentPlan({
      goal: "执行任务",
      steps: [{ capabilityId: "browser.open", description: "  ", input: {} }],
    }, registry)).toThrow("Planner step description must not be empty");
  });
});
