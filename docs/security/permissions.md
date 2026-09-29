# Permission Model

Tools are capability-scoped.

## Risk levels

### L0 — read
Examples:
- filesystem.read
- browser.extract
- github.read

### L1 — reversible low risk
Examples:
- browser.open
- device.set_volume
- create a draft task

### L2 — consequential
Examples:
- filesystem.write
- send a message
- create a pull request
- run a non-destructive command

Approval policy may be user-configured.

### L3 — high impact
Examples:
- destructive filesystem actions
- credential changes
- financial actions
- account/security changes

Always require explicit confirmation.

## Device scope

Permissions are also scoped to devices. A permission granted for a desktop does not automatically grant the same capability on an iPhone or home device.

Every tool invocation is checked at execution time.
