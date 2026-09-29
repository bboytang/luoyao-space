# Brain Service

Owns conversation orchestration.

Responsibilities:

- load relevant memory
- load relationship/persona state
- ask Conversation Director for behavior policy
- select model route
- generate response
- emit conversation and emotion events
- persist important memories

Brain does not execute arbitrary computer/device actions directly.
