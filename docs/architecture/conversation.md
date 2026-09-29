# Conversation Director

The Conversation Director is responsible for deciding **how** Luoyao responds before the language model generates wording.

It should output a behavioral policy such as:

```json
{
  "response_length": "short",
  "action": "react",
  "memory_use": "recent",
  "self_disclosure": 0.2,
  "question_probability": 0.35,
  "relationship_expression": 0.15,
  "advice_probability": 0.05,
  "teasing_probability": 0.30,
  "emotion": "playful",
  "emotion_intensity": 0.45
}
```

The model then writes the response within that policy.

## Why this exists

Prompt-only personality tends to produce repetitive behavior:

- excessive empathy
- unsolicited advice
- overlong replies
- forced relationship language
- artificial self-disclosure
- repetitive questions

The director makes these behaviors conditional instead of mandatory.

## Evaluation

Naturalness is evaluated across a conversation window, not a single sentence.

We should measure:

- response-length variance
- question frequency
- advice frequency
- self-disclosure frequency
- relationship-expression frequency
- interruption recovery
- memory relevance
- repetition rate
- fabricated-experience rate
