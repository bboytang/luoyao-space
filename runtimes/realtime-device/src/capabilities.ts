// Development-period v1 capability strings. Canonical device capabilities live in packages/protocol.
export type RealtimeCapability =
  | "audio.pcm_s16le"
  | "avatar.dynamic";

export const DEFAULT_REALTIME_CAPABILITIES: RealtimeCapability[] = [
  "audio.pcm_s16le",
  "avatar.dynamic",
];
