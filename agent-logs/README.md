# Agent logs

Tracked in git. Secrets are redacted before write (`src/lib/redact.ts`).

- `session.jsonl` / `session.md` — this Cursor agent's build steps (timestamp, your prompt, summary). **Commit and push these.**
- Product / supervisor runs go to `data/agent-runs.jsonl` and stay local (gitignored with the rest of `data/`).
