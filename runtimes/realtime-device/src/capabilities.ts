export type RealtimeCapability =
  | "audio.pcm_s16le"
  | "avatar.dynamic";

export const DEFAULT_REALTIME_CAPABILITIES: RealtimeCapability[] = [
  "audio.pcm_s16le",
  "avatar.dynamic",
];
