# System and reliability brief

## What it is

Hackerman is a Next.js Command Center. A LangGraph.js **supervisor** routes each organizer message to one worker node: Eventbrite (registration), GitHub (progress), Discord (community), or Interview. Workers call live HTTP APIs when keys exist, otherwise they run fixtures so the demo never goes blank.

## Handoff that must work

If the GitHub node labels any team `stalled` (no commits, or last commit older than `GITHUB_STALL_HOURS`, default 5), a **graph edge** sends control to the Discord node, which posts in `#alerts`. That path is also wired to the “Are any teams stuck?” demo chip so the 2-minute video does not depend on the LLM.

## How we know it works

Three fixture repos (`team-healthy`, `team-stalled`, `team-noisy`) with expected labels in `eval/fixtures.json`.

```bash
npm run eval
```

writes `eval/results.json`. Without GitHub keys the script records the expected labels (dry). With keys it classifies live commits.

Known failures:

- Discord username → member id can still miss (search + exact username/global name/nick). We always post to a channel and log `Discord lookup missed` when a role was not assigned.
- Eventbrite custom questions may be absent on the attendees payload; we still sync name/email.
- Gemini Flash-Lite is used for routing and interview scoring. If JSON parse fails, the rubric is marked `scoredBy: heuristic` with `scoreError` visible in the UI.
- `/status` is registered on the guild, but Discord will only reach `/api/discord/interactions` if you set a public Interactions Endpoint URL plus `DISCORD_PUBLIC_KEY`.
