export type ModelClass = "realtime" | "fast_chat" | "reasoning" | "embedding" | "vision";

export interface ModelRouteRequest {
  modelClass: ModelClass;
  taskType?: string;
  latencyBudgetMs?: number;
  privacyRequired?: boolean;
}

export interface ModelProvider {
  id: string;
  supports: readonly ModelClass[];
  generate(input: ModelGenerateRequest): Promise<ModelGenerateResult>;
}

export interface ModelGenerateRequest {
  modelClass: ModelClass;
  input: unknown;
  signal?: AbortSignal;
}

export interface ModelGenerateResult {
  text: string;
  providerId: string;
  modelId?: string;
}

export interface ModelRoute {
  providerId: string;
  modelClass: ModelClass;
}

export interface ModelRouter {
  route(request: ModelRouteRequest): ModelRoute;
  generate(request: ModelGenerateRequest): Promise<ModelGenerateResult>;
}

export class ModelRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRoutingError";
  }
}

export class DefaultModelRouter implements ModelRouter {
  constructor(
    private readonly providers: readonly ModelProvider[],
    private readonly routes: Partial<Record<ModelClass, string>>,
  ) {}

  route(request: ModelRouteRequest): ModelRoute {
    const preferred = this.routes[request.modelClass];
    const provider = preferred
      ? this.providers.find((candidate) =>
          candidate.id === preferred &&
          candidate.supports.includes(request.modelClass),
        )
      : this.providers.find((candidate) =>
          candidate.supports.includes(request.modelClass),
        );

    if (!provider) {
      throw new ModelRoutingError(
        `No provider available for model class: ${request.modelClass}`,
      );
    }

    return {
      providerId: provider.id,
      modelClass: request.modelClass,
    };
  }

  async generate(request: ModelGenerateRequest): Promise<ModelGenerateResult> {
    const route = this.route({ modelClass: request.modelClass });
    const provider = this.providers.find(
      (candidate) => candidate.id === route.providerId,
    );

    if (!provider) {
      throw new ModelRoutingError(
        `Routed provider is unavailable: ${route.providerId}`,
      );
    }

    return provider.generate(request);
  }
}
