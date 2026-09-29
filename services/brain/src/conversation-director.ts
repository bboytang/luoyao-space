export type ResponseLength = "very_short" | "short" | "normal" | "long";
export type ConversationAction =
  | "listen"
  | "react"
  | "tease"
  | "share"
  | "ask"
  | "comfort"
  | "solve"
  | "play";

export interface ConversationSignals {
  userMessage: string;
  recentQuestionCount: number;
  recentAdviceCount: number;
  relationshipStage: "new" | "familiar" | "close" | "deeply_connected";
  userInitiative: number;
  emotionalIntensity: number;
  topicIsTaskLike: boolean;
}

export interface BehaviorPolicy {
  responseLength: ResponseLength;
  action: ConversationAction;
  useMemory: "none" | "recent" | "memory" | "relationship";
  selfDisclosure: number;
  questionProbability: number;
  relationshipExpression: number;
  adviceProbability: number;
  teasingProbability: number;
  emotion: "calm" | "warm" | "playful" | "serious" | "curious";
  emotionIntensity: number;
}

export function directConversation(signals: ConversationSignals): BehaviorPolicy {
  const text = signals.userMessage.trim();
  const short = text.length <= 12;
  const tired = /累|疲|压力|烦|崩|难受/.test(text);
  const playful = /哈哈|帅|漂亮|真的假的|逗|笑死/.test(text);
  const explicitTask = signals.topicIsTaskLike;

  let action: ConversationAction = "react";
  if (explicitTask) action = "solve";
  else if (tired) action = "comfort";
  else if (playful) action = "tease";
  else if (short) action = "listen";

  const questionProbability = Math.max(
    0.05,
    Math.min(0.55, 0.22 + signals.userInitiative * 0.18 - signals.recentQuestionCount * 0.08),
  );

  const adviceProbability = explicitTask
    ? 0.65
    : tired
      ? 0.18
      : 0.04;

  return {
    responseLength: explicitTask ? "normal" : short ? "very_short" : "short",
    action,
    useMemory: explicitTask ? "memory" : signals.relationshipStage === "new" ? "recent" : "relationship",
    selfDisclosure: playful ? 0.35 : 0.15,
    questionProbability,
    relationshipExpression:
      signals.relationshipStage === "deeply_connected" ? 0.22 : 0.08,
    adviceProbability,
    teasingProbability: playful ? 0.55 : 0.06,
    emotion: playful ? "playful" : tired ? "warm" : "calm",
    emotionIntensity: tired || playful ? 0.55 : 0.3,
  };
}
