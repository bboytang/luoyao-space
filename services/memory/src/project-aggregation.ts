import type { MemoryRecord } from "./ranking";
import type { MemoryRepository } from "./repository";

export interface ProjectMemoryAggregationInput {
  userId: string;
  companionId: string;
  projectId: string;
  limit?: number;
}

export interface ProjectMemoryAggregation {
  projectId: string;
  memoryCount: number;
  memories: MemoryRecord[];
}

export async function aggregateProjectMemories(
  repository: MemoryRepository,
  input: ProjectMemoryAggregationInput,
): Promise<ProjectMemoryAggregation> {
  const projectId = input.projectId.trim();
  if (!projectId) throw new Error("projectId is required");

  const findProjectMemories = repository.findProjectMemories;
  if (!findProjectMemories) throw new Error("Project memory aggregation is not supported by this repository");

  const memories = await findProjectMemories.call(repository, {
    userId: input.userId,
    companionId: input.companionId,
    projectId,
    limit: Math.max(1, input.limit ?? 50),
  });

  return { projectId, memoryCount: memories.length, memories };
}
