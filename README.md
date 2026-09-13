# Hackerman

Command Center for running a hackathon with one **supervisor** and four workers: Eventbrite (registration), Discord (community), GitHub (progress), and a 15s Gemini interview. A later graph node **judges** teams (criticizer → promoter → score).

Built for a solo multi-app agent hackathon. One Next.js app, in-process LangGraph.js, Node runtime. No FastAPI, Supabase, or extra MCP servers.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind
- LangGraph.js supervisor + `createReactAgent` workers (Gemini)
- Local JSON store in `data/` (gitignored)
- Optional: Resend, Langfuse, ngrok

## Run

```bash
npm install
copy .env.example .env.local   # Windows
# cp .env.example .env.local   # macOS / Linux
# fill keys in .env.local — never commit that file
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Interview room: [http://localhost:3000/interview](http://localhost:3000/interview).

```bash
npm run eval    # live GitHub health eval (needs GITHUB_TOKEN)
npm run e2e     # hits local /api/state and interview question
npm run tunnel  # ngrok http 3000 — keep npm run dev running
```

The dashboard **Copy interview link** button appears when ngrok is up. Send friends `https://YOUR-NGROK-HOST/interview` only. Free ngrok may show a “Visit Site” interstitial once. The URL changes if you restart the tunnel.

## Environment

Copy `.env.example` → `.env.local`. Empty keys mean that agent stays on fixtures / dry-run.

| Variable | Required for live | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Routing + interview + judge | Default model `gemini-3.5-flash-lite` |
| `GITHUB_TOKEN` + `GITHUB_OWNER` | Repos + health | Classic PAT, `repo` scope. Owner is your user or an org you already have. |
| `GITHUB_REPOS` | Optional | Default `team-healthy,team-stalled,team-noisy` |
| `GITHUB_STALL_HOURS` | Optional | Default `5` |
| `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` | Channels, roles, posts | Members Intent on. Bot role above Hacker/Stalled. |
| `DISCORD_PUBLIC_KEY` | `/status` slash only | Also set Interactions URL to a **public** host |
| `EVENTBRITE_TOKEN` + `EVENTBRITE_ORGANIZATION_ID` | Create/sync events | Event id is optional; the agent can create one |
| `RESEND_API_KEY` | Welcome email | Sandbox `onboarding@resend.dev` only delivers to `RESEND_TEST_TO` |
| `LANGFUSE_*` | Optional | Supervisor traces only on free tier |

Channel and role IDs in `.env.example` are optional. The Discord agent creates them and stores IDs in `data/store.json`.

Do not commit `.env.local`, `data/store.json`, interview clips, or `agent-logs/`. See `.gitignore`.

## UI

Header toggle: **Data** or **Chat** (one at a time).

**Data**

- Pipeline checklist (10 steps, live vs fixture badges)
- Tabs: Hackathons, Registration, Progress, Community, Interview, Board, Ops
- Live feed + pane for the selected tab

**Chat**

- Action chips (stand up, sync, stall, nudge, welcome, judge, leaderboard)
- Agent tabs: Supervisor, Onboard, Projects, Community, Interview
- Full-height thread. Running a chip switches you to Chat.

**Hackathons tab** — multiple events. Each has its own Eventbrite event and dashboard slice. New hackathon → Chat asks a brief, or fill the form. Empty fields become generic defaults.

## Agents

```
Organizer (chip or typed prompt)
        ↓
  Supervisor (keywords, or Gemini one-word route)
        ↓
  pipeline | eventbrite | github | discord | interview | judge
```

**Supervisor** — routes. On first stand-up it asks: name, topic, description, ticket price, start, end. Reply with answers or `GENERIC` / `DEFAULTS`.

**Registration (Eventbrite + Resend)** — create/reuse event, ticket, Discord/GitHub intake questions, publish, sync attendees, reopen sales if dates lapsed, capacity check, incomplete invitees, welcome email + Meet link.

**Progress (GitHub)** — ensure `team-*` repos, health scan (healthy / stalled / noisy), stall issues, sponsor-stack scan from `package.json` + languages.

**Community (Discord)** — category, agent rooms, onboarding/alerts/announcements, Hacker + Stalled roles, team channels, onboard + role assign by username, stall nudge, GitHub→Discord handoff, leaderboard post, matchmake solos. `/status` is registered but localhost cannot receive Discord slash hits.

**Interview** — `/interview` records 15s camera + voice. Gemini asks one question, then scores frames + transcript (eye contact, reading from script). Dummy/text fallback is marked `heuristic`.

**Judge** — criticizer, promoter, then a 0–100 GitHub judge. Scores land on Board and can be posted to Discord.

Workers first try Gemini ReAct tools (`src/lib/tools.ts`). If that fails they fall back to keyword paths. Discord tools are capped so they do not loop past the recursion limit.

## Stand-up pipeline

Deterministic 11 steps (`force: pipeline` / STAND UP chip), after the brief is confirmed:

1. Eventbrite event (or reopen sales on an ended event)
2. Ticket class (free or priced from the brief)
3. Intake questions (Discord + GitHub usernames)
4. Publish (invite draft is OK if publish 400s)
5. Discord guild setup
6. GitHub team repos
7. Team Discord channels
8. Sync attendees
9. Discord onboard
10. GitHub health scan
11. Welcome emails

Interview is not in this pipeline. Organizer or a remote friend runs `/interview` separately.

## Remote friend (participant)

They do **not** need your Wi‑Fi for Eventbrite, Discord, or GitHub.

1. You run `npm run dev` and (for interview) `npm run tunnel`.
2. They register on the Eventbrite URL from the Registration pane. Intake must use their **exact** Discord username and GitHub username.
3. They join Discord from the Community invite.
4. You hit **SYNC + ONBOARD**. Roles assign only if the username matches a member already in the server.
5. Welcome mail goes to **your** Resend inbox while using `onboarding@resend.dev`. Send them the invite and Meet link yourself.
6. They open the ngrok `/interview` link, allow camera + mic, speak ~15s.
7. You run **ARE ANY TEAMS STUCK?**, **NUDGE**, **JUDGE**, **POST LEADERBOARD**.

Same Wi‑Fi / LAN is only needed if they must open your laptop’s app without a tunnel.

## Live vs fixture

Header tags show which APIs have keys. Checklist rows show `live` / `fixture` / `unknown`. Missing keys still let the dashboard demo with dry-run activities.

GitHub stall = no commit for `GITHUB_STALL_HOURS` (default 5). Seed repos: `team-healthy` (recent commit + README + stack), `team-stalled` (idle), `team-noisy` (many files, weak README).

## Layout

```
src/app/                  pages + API routes
src/components/           Command Center + brand marks
src/lib/graph.ts          LangGraph supervisor
src/lib/pipeline.ts       deterministic stand-up
src/lib/tools.ts          ReAct tools
src/lib/agents/           Eventbrite, Discord, GitHub, Resend, interview, judge
src/lib/store.ts          multi-hackathon JSON store
eval/                     GitHub health eval
```

State: `data/store.json`. Traces: Ops tab + `data/agent-runs.jsonl`. Langfuse (optional) gets supervisor routes only.

## Discord bot (manual)

Developer Portal → Bot: Members Intent on. Invite scope `bot`. Permissions: Manage Channels, Manage Roles, Send Messages, View Channels, Read History. Put the bot role above Hacker and Stalled. Guild ID from the server. `/status` also needs `DISCORD_PUBLIC_KEY` and Interactions Endpoint URL = `https://YOUR-PUBLIC-HOST/api/discord/interactions`.

## GitHub PAT

Classic token, check the parent `repo` scope. `GITHUB_OWNER` is an existing user or org. The API cannot create a new organization.

## License

Private hackathon project unless you add a license.
