# Handoff: log.md

`log.md` in `taskDir` is where each session says what it left behind, so the
next session - or the user, days later - can pick up without re-reading the
transcript.

Write an entry **when you move the task to `review`**, and **whenever the user
asks**. Append it at the end. Never edit or delete an earlier entry.

## Format

```markdown
## 2026-11-16 14:05 · codex · api

**Changed**
- Added `partitionEvents()` in `src/db/partition.ts`, called from the nightly job.
- Migration `0042_partition_events.sql`.

**Proof**
- `npm test` passes (212 tests), including 4 new ones in `partition.test.ts`.
- Ran the job against a local copy: 3 partitions created, row counts match.

**Risks**
- Not tried on a table above 10M rows; the lock may be held for minutes.

**Next**
- Phase 3 of the plan: backfill old rows.
```

- The heading: date and time (`date '+%F %H:%M'`), the agent, and the repo of
  the workspace you worked in.
- **Changed** - what is different now, with file paths. Not a diary of steps.
- **Proof** - what shows it works: commands run and their result, manual
  checks. "Tests pass" without the command is not proof.
- **Risks** - what could still be wrong, what was not tested, assumptions. Say
  "None known" only when you mean it.
- **Next** - only when work remains: the first concrete step.

Keep an entry short enough to read in under a minute. Detail belongs in the
plan or a note; link to it.
