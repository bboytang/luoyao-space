# Task Service

Durable task state machine.

It is deliberately separate from the conversational agent so tasks survive:

- app restarts
- device changes
- websocket disconnects
- model failures
- user leaving the conversation

Chat is an interface to tasks, not the task storage itself.
