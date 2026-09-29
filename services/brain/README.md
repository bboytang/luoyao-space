# Brain Service

Owns conversation orchestration.

Responsibilities:

- load relationship state before response policy decisions
- run Conversation Director before model generation
- load relevant memory according to the selected behavior policy
- load relationship/persona state
- ask Conversation Director for behavior policy
- select model route
- generate response
- emit conversation and emotion events
- persist important memories

Brain does not execute arbitrary computer/device actions directly.
