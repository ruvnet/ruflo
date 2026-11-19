---
name: review-team-deliverables
description: Checks an AI team run against its acceptance criteria using the evidence bundle. Use when the user asks whether the work is done or correct, or before completing a run. Separates verified evidence from agent claims.
allowed-tools: Read
---

# Review Team Deliverables

Uses the RuFlo AI Team connector (server name ruflo-ai-team): the tools team_get, task_list, memory_search and evidence_export.

Retrieve the evidence bundle and compare each acceptance criterion with a concrete task result or artifact reference. Separate verified facts, agent assertions, uncertainty, and missing work. Report the recorded budget without presenting it as enforced or billed. Recommend completion only when every required criterion has evidence; the user decides whether to complete the run.

Next: if every criterion has evidence and the user agrees, use the manage-team-lifecycle skill to complete the run; if not, use the coordinate-team-work skill to add tasks for the gaps.
