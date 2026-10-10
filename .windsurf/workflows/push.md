---
description: Push authorized commits or release tags with the canonical project push skill
---

Read and follow [the project push skill](../../.agents/skills/push/SKILL.md) and only the references relevant to the user's request. That file is the authoritative procedure for this workflow.

Use the user's current scope and existing authorization. Invoking a workflow does not expand it to unrelated fixes or Git operations. If the skill cannot be read, report the missing source before executing the operation; do not fall back to a copied legacy procedure.
