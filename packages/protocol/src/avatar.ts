export type AvatarEmotion =
  | "calm"
  | "warm"
  | "playful"
  | "serious"
  | "curious"
  | "happy"
  | "sad"
  | "surprised"
  | "concerned";

export type AvatarExpression =
  | "neutral"
  | "smile"
  | "soft_smile"
  | "concerned"
  | "curious"
  | "playful"
  | "serious"
  | "surprised";

export interface AvatarEmotionEventData {
  emotion: AvatarEmotion;
  intensity: number;
  expression: AvatarExpression;
  transitionMs?: number;
}

export function isAvatarEmotionEventData(
  value: unknown,
): value is AvatarEmotionEventData {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<AvatarEmotionEventData>;
  if (typeof candidate.emotion !== "string") return false;
  if (typeof candidate.expression !== "string") return false;
  if (typeof candidate.intensity !== "number" || !Number.isFinite(candidate.intensity)) {
    return false;
  }
  if (candidate.intensity < 0 || candidate.intensity > 1) return false;
  if (
    candidate.transitionMs !== undefined &&
    (!Number.isInteger(candidate.transitionMs) || candidate.transitionMs < 0)
  ) {
    return false;
  }

  return (
    [
      "calm",
      "warm",
      "playful",
      "serious",
      "curious",
      "happy",
      "sad",
      "surprised",
      "concerned",
    ] as string[]
  ).includes(candidate.emotion) &&
    [
      "neutral",
      "smile",
      "soft_smile",
      "concerned",
      "curious",
      "playful",
      "serious",
      "surprised",
    ].includes(candidate.expression);
}
