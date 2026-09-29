# Agent Service

Owns the durable agent loop.

Responsibilities:

1. accept a goal
2. create a durable task
3. plan
4. request approval when required
5. invoke capabilities through Tool Runtime
6. consume results
7. continue or pause
8. emit task events
9. persist outcomes into Memory OS
