export type MemoryObservationAttributes = Readonly<Record<string, string | number | boolean>>;

export interface MemoryObservability {
  increment(
    metric: string,
    value?: number,
    attributes?: MemoryObservationAttributes,
  ): void;
  observe(
    metric: string,
    value: number,
    attributes?: MemoryObservationAttributes,
  ): void;
}

export const noopMemoryObservability: MemoryObservability = {
  increment() {},
  observe() {},
};
