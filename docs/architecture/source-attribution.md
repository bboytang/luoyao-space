# Source Attribution

Luoyao Space keeps repository filenames and module names owned by the Luoyao Space architecture. Upstream influence or adaptation is recorded in file headers and in this document rather than by retaining upstream project names in paths.

## Attribution classes

### 1. Adapted upstream code

Use when code is copied or materially adapted from an upstream open-source implementation.

```ts
/**
 * Source Attribution
 *
 * Origin: upstream open-source project
 * Upstream: <repository>
 * License: <license>
 *
 * This file has been adapted for Luoyao Space.
 * It is not part of the upstream project and may contain
 * Luoyao Space-specific modifications.
 */
```

### 2. Independent implementation based on a design reference

Use when the implementation is written independently but the architecture or protocol was informed by an upstream project.

```ts
/**
 * Design Reference
 *
 * Inspired by: upstream open-source project
 * License reference: <license>
 *
 * This implementation is independently written for Luoyao Space.
 */
```

### 3. Original Luoyao Space implementation

Use for code designed and implemented within Luoyao Space.

```text
Origin: Luoyao Space
Reference: none
Status: Original implementation
```

## Current provenance map

| Module / area | Provenance | Treatment | License / reference |
|---|---|---|---|
| Realtime session runtime | XiaoZhi open-source project | Adapted where upstream code is reused; otherwise independently rewritten | MIT |
| Audio pipeline / streaming patterns | XiaoZhi open-source project | Design reference or adaptation, recorded per file | MIT |
| Device capability protocol | XiaoZhi + Luoyao Space | Derived design, independently implemented unless explicitly marked adapted | MIT / reference |
| Memory OS | Luoyao Space | Original | — |
| Relationship OS | Luoyao Space | Original | — |
| Conversation Director | Luoyao Space | Original | — |
| Agent OS | Luoyao Space | Original | — |
| Task engine | Luoyao Space | Original | — |
| Proactive engine | Luoyao Space | Original | — |

## Rules

1. Do not preserve upstream project names in Luoyao Space filenames merely to indicate provenance.
2. Do not remove attribution from materially adapted upstream code.
3. Prefer an explicit file header over vague repository-level wording.
4. Distinguish **adapted code** from **independent code inspired by a design**.
5. Keep third-party license obligations with the adapted code and its distribution path.
6. If provenance is uncertain, mark the file for review instead of guessing.
