const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function call(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

function summarizeState(state, checklist) {
  return {
    eventId: state.eventId ?? null,
    attendees: state.attendees?.length ?? 0,
    teams: (state.teams ?? []).map((t) => `${t.name}:${t.health}`),
    discordInvite: Boolean(state.discord?.inviteUrl),
    teamChannels: (state.discord?.teamChannels ?? []).map((c) => c.name),
    interviews: state.interviews?.length ?? 0,
    checklist: (checklist ?? []).map((c) => `${c.done ? "DONE" : "TODO"} ${c.label}`),
  };
}

const out = { base: BASE, steps: [] };

const state1 = await call("/api/state");
out.steps.push({
  name: "state",
  status: state1.status,
  connections: state1.json.connections,
  summary: summarizeState(state1.json.state ?? {}, state1.json.checklist),
});

const question = await call("/api/interview/question");
out.steps.push({
  name: "interview-question",
  status: question.status,
  hasQuestion: Boolean(question.json.question),
});

const pipeline = await call("/api/chat", {
  method: "POST",
  body: JSON.stringify({
    message:
      "Stand up the full hackathon: Eventbrite event + ticket, Discord channels/roles, GitHub repos, onboard, scan teams.",
    force: "pipeline",
  }),
});
out.steps.push({
  name: "pipeline",
  status: pipeline.status,
  error: pipeline.json.error ?? null,
  replyPreview: String(pipeline.json.reply ?? "").slice(0, 500),
  summary: summarizeState(pipeline.json.state ?? {}, []),
});

const stuck = await call("/api/chat", {
  method: "POST",
  body: JSON.stringify({
    message: "Are any teams stuck? Check GitHub and hand off stalled teams to Discord.",
    force: "github",
  }),
});
out.steps.push({
  name: "stuck",
  status: stuck.status,
  error: stuck.json.error ?? null,
  replyPreview: String(stuck.json.reply ?? "").slice(0, 400),
});

const state2 = await call("/api/state");
out.steps.push({
  name: "state-after",
  status: state2.status,
  summary: summarizeState(state2.json.state ?? {}, state2.json.checklist),
  traces: (state2.json.traces ?? []).slice(0, 8).map((t) => `${t.name}: ${String(t.output).slice(0, 80)}`),
  langfuse: state2.json.langfuse,
});

const traces = await call("/api/traces");
out.steps.push({
  name: "traces",
  status: traces.status,
  langfuse: traces.json.langfuse,
  count: traces.json.traces?.length ?? 0,
});

const failed = out.steps.filter((s) => s.status >= 400 || s.error);
out.ok = failed.length === 0;
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exitCode = 1;
