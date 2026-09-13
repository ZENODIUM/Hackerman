"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandMark, brandForAgent, brandForChecklist, type PartnerBrand } from "@/components/BrandMarks";
import { buildLeaderboard } from "@/lib/leaderboard";
import type { Activity, AgentId, AgentTrace, AppState, ChecklistItem, ChecklistSource, ChecklistStatus, HackathonBrief, JudgingRound, TeamHealth } from "@/lib/types";

type Connections = {
  gemini: boolean;
  github: boolean;
  discord: boolean;
  eventbrite: boolean;
  resend: boolean;
  langfuse: boolean;
};

type ChatLine = { role: "user" | "assistant"; text: string };
type TabId = AgentId | "ops" | "board" | "hackathons";
type ChatTarget = "supervisor" | "registration" | "progress" | "community" | "interview";
type ViewMode = "data" | "chat";

const CHAT_TABS: { id: ChatTarget; label: string }[] = [
  { id: "supervisor", label: "Supervisor" },
  { id: "registration", label: "Onboard" },
  { id: "progress", label: "Projects" },
  { id: "community", label: "Community" },
  { id: "interview", label: "Interview" },
];

const TABS: { id: TabId; label: string; icon?: string; brand?: PartnerBrand; color: string }[] = [
  { id: "hackathons", label: "Hackathons", icon: "HX", color: "btn-clay" },
  { id: "registration", label: "Registration", brand: "eventbrite", color: "btn-blue" },
  { id: "progress", label: "Progress", brand: "github", color: "btn-lime" },
  { id: "community", label: "Community", brand: "discord", color: "btn-pink" },
  { id: "interview", label: "Interview", icon: "AI", color: "btn-lilac" },
  { id: "board", label: "Board", brand: "github", color: "btn-clay" },
  { id: "ops", label: "Ops + logs", icon: "LF", color: "btn-clay" },
];

const CHIPS: { step: string; label: string; color: string; href?: string; force?: string; message?: string }[] = [
  {
    step: "pipeline",
    label: "STAND UP HACKATHON",
    color: "btn-clay",
    force: "pipeline",
    message:
      "Stand up the full hackathon: Eventbrite event + ticket, Discord channels/roles, GitHub repos, onboard, scan teams.",
  },
  { step: "sync", label: "SYNC + ONBOARD", color: "btn-blue", force: "eventbrite", message: "Sync Eventbrite attendees and onboard them on Discord." },
  { step: "stuck", label: "ARE ANY TEAMS STUCK?", color: "btn-clay", force: "github", message: "Are any teams stuck? Check GitHub and hand off stalled teams to Discord." },
  { step: "nudge", label: "NUDGE STALLED TEAM", color: "btn-pink", force: "discord", message: "Ask GitHub for a health scan, then nudge stalled teams on Discord." },
  { step: "email", label: "WELCOME + MEET LINK", color: "btn-lime", force: "eventbrite", message: "Send welcome emails with the Meet link." },
  { step: "interview", label: "RUN AI INTERVIEW", color: "btn-lilac", href: "/interview" },
  { step: "judge", label: "JUDGE PROJECTS", color: "btn-clay", force: "judge", message: "Judge every team: criticizer finds flaws, promoter argues strengths, GitHub judge scores 0-100." },
  { step: "board-post", label: "POST LEADERBOARD", color: "btn-pink", force: "discord", message: "Post the leaderboard to Discord #announcements." },
];

const FORCE_BY_TAB: Partial<Record<TabId, string>> = {
  registration: "eventbrite",
  progress: "github",
  community: "discord",
  interview: "interview",
};

const EMPTY_STATE: AppState = {
  currentHackathonId: "",
  hackathons: [],
  attendees: [],
  teams: [],
  activities: [],
  interviews: [],
  judging: [],
  pipeline: {},
  discord: {},
};

function healthTag(h: TeamHealth) {
  if (h === "healthy") return "tag tag-healthy";
  if (h === "stalled") return "tag tag-stalled";
  if (h === "noisy") return "tag tag-noisy";
  return "tag tag-unknown";
}

function checkStatus(item: ChecklistItem): ChecklistStatus {
  return item.status ?? (item.done ? "done" : "todo");
}

function checkClass(status: ChecklistStatus) {
  if (status === "done") return "check-done";
  if (status === "pending") return "check-pending";
  return "check-todo";
}

function checkLabel(status: ChecklistStatus) {
  if (status === "done") return "DONE";
  if (status === "pending") return "PENDING";
  return "NOT YET";
}

function toLocalInput(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sourceTag(source?: ChecklistSource) {
  if (source === "live") return "tag tag-live";
  if (source === "fixture") return "tag tag-dead";
  return "tag tag-unknown";
}

const PANE: Record<TabId, { detail: string; head: string }> = {
  hackathons: { detail: "pane-attendees", head: "pane-head-attendees" },
  registration: { detail: "pane-attendees", head: "pane-head-attendees" },
  progress: { detail: "pane-teams", head: "pane-head-teams" },
  community: { detail: "pane-discord", head: "pane-head-discord" },
  interview: { detail: "pane-interview", head: "pane-head-interview" },
  board: { detail: "pane-teams", head: "pane-head-teams" },
  ops: { detail: "pane-ops", head: "pane-head-ops" },
  supervisor: { detail: "pane-feed", head: "pane-head-feed" },
};

export function CommandCenter() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [connections, setConnections] = useState<Connections | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [langfuse, setLangfuse] = useState(false);
  const [view, setView] = useState<ViewMode>("data");
  const [tab, setTab] = useState<TabId>("hackathons");
  const [briefDraft, setBriefDraft] = useState<Partial<HackathonBrief>>({});
  const [chatTarget, setChatTarget] = useState<ChatTarget>("supervisor");
  const [input, setInput] = useState("");
  const [chats, setChats] = useState<Record<string, ChatLine[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interviewUrl, setInterviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;

  async function refresh() {
    const res = await fetch("/api/state", { cache: "no-store" });
    const json = (await res.json()) as {
      state: AppState;
      connections: Connections;
      checklist: ChecklistItem[];
      traces: AgentTrace[];
      langfuse: boolean;
    };
    setState(json.state);
    setConnections(json.connections);
    setChecklist(json.checklist ?? []);
    setTraces(json.traces ?? []);
    setLangfuse(Boolean(json.langfuse));
    if (json.state.brief) setBriefDraft(json.state.brief);
  }

  useEffect(() => {
    void refresh();
    const tick = window.setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 4000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    async function loadTunnel() {
      try {
        const res = await fetch("/api/tunnel", { cache: "no-store" });
        const json = (await res.json()) as { online?: boolean; interviewUrl?: string };
        setInterviewUrl(json.online && json.interviewUrl ? json.interviewUrl : null);
      } catch {
        setInterviewUrl(null);
      }
    }
    void loadTunnel();
    const tick = window.setInterval(() => void loadTunnel(), 8000);
    return () => window.clearInterval(tick);
  }, []);

  function applyActivities(activities: Activity[]) {
    const worker = [...activities].reverse().find((a) => a.agent !== "supervisor");
    if (worker && worker.agent !== "supervisor") setTab(worker.agent);
  }

  async function hackathonAction(action: "create" | "select" | "updateBrief", extra?: { id?: string; brief?: Partial<HackathonBrief> }) {
    const res = await fetch("/api/hackathons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const json = (await res.json()) as { state?: AppState; error?: string };
    if (!res.ok) throw new Error(json.error ?? "hackathon action failed");
    if (json.state) {
      setState(json.state);
      if (json.state.brief) setBriefDraft(json.state.brief);
    }
    await refresh();
  }

  async function runChat(message: string, force?: string, target: ChatTarget = chatTarget) {
    setBusy(true);
    setError(null);
    setChatTarget(target);
    setView("chat");
    const line: ChatLine = { role: "user", text: message };
    setChats((c) => ({ ...c, [target]: [...(c[target] ?? []), line] }));
    const resolvedForce = force ?? (target === "supervisor" ? undefined : FORCE_BY_TAB[target]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, force: resolvedForce }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "chat failed");
      const reply: ChatLine = { role: "assistant", text: json.reply };
      setChats((c) => ({ ...c, [target]: [...(c[target] ?? []), reply] }));
      setState(json.state);
      applyActivities(json.activities ?? []);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  const feed = useMemo(
    () =>
      tab === "ops" || tab === "board" || tab === "hackathons"
        ? state.activities.slice().reverse()
        : state.activities.filter((a) => a.agent === tab).slice().reverse(),
    [state.activities, tab],
  );

  const doneCount = checklist.filter((c) => c.done).length;
  const liveCount = checklist.filter((c) => c.done && c.source === "live").length;
  const board = useMemo(() => buildLeaderboard(state), [state]);
  const thread = chats[chatTarget] ?? [];
  const chatLabel = CHAT_TABS.find((t) => t.id === chatTarget)?.label ?? "Supervisor";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--paper)]">
      <header className="hard-border mx-3 mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3 bg-[var(--accent)] px-4 py-3 block-shadow">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-3xl md:text-4xl">Hackerman</h1>
          <div className="flex gap-1.5">
            <button
              type="button"
              data-active={view === "data"}
              onClick={() => setView("data")}
              className="tab-brutal px-4 py-1.5 text-sm"
            >
              Data
            </button>
            <button
              type="button"
              data-active={view === "chat"}
              onClick={() => setView("chat")}
              className="tab-brutal px-4 py-1.5 text-sm"
            >
              Chat
            </button>
          </div>
          <p className="font-mono text-[11px] font-bold uppercase">
            {doneCount}/{checklist.length || 10} done · {liveCount} live
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connections &&
            Object.entries(connections).map(([k, v]) => (
              <span key={k} className={`tag ${v ? "tag-live" : "tag-dead"}`}>
                {k}
              </span>
            ))}
          <Link href="/interview" className="btn-brutal btn-pink px-3 py-2 text-sm">
            Interview
          </Link>
          {interviewUrl ? (
            <button
              type="button"
              className="btn-brutal btn-blue px-3 py-2 text-sm"
              onClick={() => {
                void navigator.clipboard.writeText(interviewUrl);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied" : "Copy interview link"}
            </button>
          ) : (
            <span className="tag tag-dead">tunnel off</span>
          )}
        </div>
      </header>

      {view === "data" ? (
      <section className="mx-3 mt-3 shrink-0 hard-border bg-[#fff8e8] p-3 block-shadow">
        <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em]">
          Pipeline
        </p>
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {checklist.map((item) => {
            const status = checkStatus(item);
            return (
              <li key={item.id} className={`${checkClass(status)} px-2.5 py-2`}>
                <div className="flex items-center justify-between gap-1">
                  <p className="font-mono text-[10px] font-bold uppercase">{checkLabel(status)}</p>
                  <span className="inline-flex items-center gap-1">
                    {brandForChecklist(item.id) && <BrandMark brand={brandForChecklist(item.id)!} size="sm" />}
                    <span className={sourceTag(item.source)}>{item.source ?? "unknown"}</span>
                  </span>
                </div>
                <p className="text-sm font-bold leading-snug">{item.label}</p>
                {item.detail && <p className="mt-0.5 truncate text-xs" title={item.detail}>{item.detail}</p>}
              </li>
            );
          })}
        </ol>
      </section>
      ) : null}

      {view === "chat" ? (
      <main className="mx-3 mb-3 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden border-[3px] border-[var(--ink)] bg-[var(--paper-2)]">
        <div className="relative z-20 grid shrink-0 grid-cols-2 gap-1.5 border-b-[3px] border-[var(--ink)] bg-[var(--panel)] p-2 md:grid-cols-4">
          {CHIPS.map((c) =>
            c.href ? (
              <Link
                key={c.step}
                href={c.href}
                className={`chip-brutal px-2 py-1.5 text-left text-[10px] font-bold leading-tight ${c.color ? `btn-brutal ${c.color} !shadow-[2px_2px_0_#111]` : ""}`}
              >
                {c.label}
              </Link>
            ) : (
              <button
                key={c.step}
                type="button"
                disabled={busy}
                onClick={() => void runChat(c.message ?? c.label, c.force, "supervisor")}
                className={`chip-brutal px-2 py-1.5 text-left text-[10px] font-bold leading-tight ${c.color ? `btn-brutal ${c.color} !shadow-[2px_2px_0_#111]` : ""}`}
              >
                {c.label}
              </button>
            ),
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b-[3px] border-[var(--ink)] bg-[var(--accent-3)] p-2">
          {CHAT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-active={chatTarget === t.id}
              onClick={() => setChatTarget(t.id)}
              className="tab-brutal px-3 py-1.5 text-xs"
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {thread.length === 0 && (
            <p className="font-mono text-[11px] font-bold uppercase text-[var(--ink)]/70">
              {chatLabel} chat. Switch to Data anytime to see the dashboard.
            </p>
          )}
          {thread.map((line, i) => (
            <div key={`${line.role}-${i}`} className={line.role === "user" ? "chat-user p-3" : "chat-assistant p-3"}>
              <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
                {line.role === "user" ? "ORGANIZER" : chatLabel.toUpperCase()}
              </p>
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{line.text}</p>
            </div>
          ))}
        </div>
        <form
          className="flex shrink-0 gap-3 border-t-[3px] border-[var(--ink)] bg-[var(--panel)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const msg = input.trim();
            if (!msg || busy) return;
            setInput("");
            void runChat(msg);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={chatTarget === "supervisor" ? "STAND UP THE HACKATHON" : `Talk to the ${chatLabel.toLowerCase()} agent`}
            className="input-brutal px-3 py-3 text-sm"
          />
          <button type="submit" disabled={busy} className="btn-brutal px-5 py-3 text-lg">
            {busy ? "..." : chatTarget === "supervisor" ? "RUN" : "ASK"}
          </button>
        </form>
        {error && (
          <p className="border-t-[3px] border-[var(--ink)] bg-[var(--accent-2)] px-3 py-2 text-sm">
            ERR // {error}
          </p>
        )}
      </main>
      ) : (
      <main className="mx-3 mb-3 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden border-[3px] border-[var(--ink)] bg-[var(--paper)]">
        <div className="flex shrink-0 flex-wrap gap-2 border-b-[3px] border-[var(--ink)] bg-[var(--paper-2)] p-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-active={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`tab-brutal flex items-center gap-2 px-3 py-2 leading-none text-sm ${tab === t.id ? t.color : ""}`}
            >
              {t.brand ? (
                <BrandMark brand={t.brand} size="md" />
              ) : (
                <span className="hard-border bg-white px-1 font-mono text-[10px] leading-none">{t.icon}</span>
              )}
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden xl:grid-cols-2">
            <div className="pane-feed flex min-h-0 flex-col border-b-[3px] border-[var(--ink)] xl:border-b-0 xl:border-r-[3px]">
              <div className="pane-head pane-head-feed shrink-0 px-4 pt-4">
                <h3 className="flex items-center gap-2 text-3xl">
                  {brandForAgent(tab) && <BrandMark brand={brandForAgent(tab)!} size="lg" />}
                  {tab === "ops" ? "All activity" : "Live feed"}
                </h3>
              </div>
              <ol className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                {feed.length === 0 && (
                  <li className="card-brutal bg-white p-3 text-sm">No events yet for this pane.</li>
                )}
                {feed.map((a) => (
                  <li key={a.id} className="card-brutal feed-card p-3">
                    <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase">
                      {brandForAgent(a.agent) && <BrandMark brand={brandForAgent(a.agent)!} size="sm" />}
                      {new Date(a.ts).toLocaleString()} · {a.agent} · {a.ok ? "ok" : "fail"}
                    </p>
                    <p className="display mt-1 text-xl normal-case">{a.title}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{a.detail}</p>
                  </li>
                ))}
              </ol>
            </div>

            <div className={`flex min-h-0 flex-col ${PANE[tab].detail}`}>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "hackathons" && (
                <div className="space-y-4">
                  <div className={`pane-head ${PANE.hackathons.head}`}>
                    <h3 className="text-3xl">Hackathons</h3>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {(state.hackathons ?? []).map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          data-active={row.id === state.currentHackathonId}
                          onClick={() => void hackathonAction("select", { id: row.id })}
                          className="tab-brutal flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                        >
                          <span>
                            <span className="display text-lg normal-case">{row.name}</span>
                            <span className="mt-1 block font-mono text-[10px] font-bold uppercase">
                              {row.topic} · {new Date(row.startAt).toLocaleString()}
                            </span>
                          </span>
                          {row.id === state.currentHackathonId ? <span className="tag tag-live">current</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="btn-brutal btn-clay px-3 py-2 text-sm"
                    onClick={() => {
                      void hackathonAction("create").then(() => setView("chat"));
                    }}
                  >
                    New hackathon
                  </button>
                  <div className="card-brutal space-y-2 bg-white p-3">
                    <p className="font-mono text-[11px] font-bold uppercase">Brief for current event</p>
                    <input className="input-brutal px-2 py-2 text-sm" placeholder="Name" value={briefDraft.name ?? ""} onChange={(e) => setBriefDraft((b) => ({ ...b, name: e.target.value }))} />
                    <input className="input-brutal px-2 py-2 text-sm" placeholder="Topic" value={briefDraft.topic ?? ""} onChange={(e) => setBriefDraft((b) => ({ ...b, topic: e.target.value }))} />
                    <textarea className="input-brutal px-2 py-2 text-sm" placeholder="Description" rows={3} value={briefDraft.description ?? ""} onChange={(e) => setBriefDraft((b) => ({ ...b, description: e.target.value }))} />
                    <input className="input-brutal px-2 py-2 text-sm" placeholder="Price (free or 15)" value={briefDraft.priceLabel ?? ""} onChange={(e) => setBriefDraft((b) => ({ ...b, priceLabel: e.target.value, free: /^free|^0/i.test(e.target.value), cost: e.target.value.replace(/[^0-9.]/g, "") || undefined }))} />
                    <input className="input-brutal px-2 py-2 text-sm" type="datetime-local" value={toLocalInput(briefDraft.startAt)} onChange={(e) => setBriefDraft((b) => ({ ...b, startAt: new Date(e.target.value).toISOString() }))} />
                    <input className="input-brutal px-2 py-2 text-sm" type="datetime-local" value={toLocalInput(briefDraft.endAt)} onChange={(e) => setBriefDraft((b) => ({ ...b, endAt: new Date(e.target.value).toISOString() }))} />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-brutal btn-blue px-3 py-2 text-sm"
                        onClick={() => void hackathonAction("updateBrief", { brief: briefDraft })}
                      >
                        Save brief
                      </button>
                      <button
                        type="button"
                        className="btn-brutal px-3 py-2 text-sm"
                        onClick={() => {
                          void hackathonAction("updateBrief", { brief: briefDraft }).then(() =>
                            runChat("STAND UP THE HACKATHON", "pipeline", "supervisor"),
                          );
                        }}
                      >
                        Save + stand up
                      </button>
                    </div>
                    <p className="text-xs leading-relaxed">
                      Empty fields become generic data. STAND UP in Chat also asks these questions.
                    </p>
                  </div>
                </div>
              )}
              {tab === "registration" && (
                <div>
                  <div className={`pane-head ${PANE.registration.head}`}>
                    <h3 className="flex items-center gap-2 text-3xl">
                      <BrandMark brand="eventbrite" size="lg" />
                      Attendees
                    </h3>
                  </div>
                  {state.eventId && (
                    <p className="mb-3 font-mono text-xs font-bold uppercase">
                      Event {state.eventId}
                      {state.eventUrl ? ` · ${state.eventUrl}` : ""}
                    </p>
                  )}
                  <ul className="flex flex-col gap-4">
                    {state.attendees.map((a) => (
                      <li key={a.id} className="card-brutal attendee-card p-3">
                        <p className="display text-2xl normal-case">{a.name}</p>
                        <p className="mt-1 text-sm leading-relaxed">
                          {a.email} · @{a.discord ?? "n/a"} · {a.github ?? "n/a"}
                        </p>
                      </li>
                    ))}
                    {!state.attendees.length && (
                      <li className="card-brutal bg-[var(--dead)] p-3 text-sm">Run STAND UP or SYNC.</li>
                    )}
                  </ul>
                </div>
              )}
              {tab === "progress" && (
                <div>
                  <div className={`pane-head ${PANE.progress.head}`}>
                    <h3 className="flex items-center gap-2 text-3xl">
                      <BrandMark brand="github" size="lg" />
                      Team health
                    </h3>
                  </div>
                  <ul className="flex flex-col gap-4">
                    {state.teams.map((t) => (
                      <li key={t.id} className="card-brutal team-card p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="display text-2xl normal-case">{t.name}</p>
                          <span className={healthTag(t.health)}>{t.health}</span>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed">{t.notes}</p>
                        {!!t.stack.length && (
                          <p className="mt-1 font-mono text-[10px] font-bold uppercase">
                            stack {t.stack.join(" · ")}
                          </p>
                        )}
                        {!!t.prizes?.length && (
                          <p className="mt-1 text-xs font-bold">{t.prizes.join(" · ")}</p>
                        )}
                        {typeof t.judgeScore === "number" && (
                          <p className="mt-1 font-mono text-xs font-bold uppercase">judge {t.judgeScore}</p>
                        )}
                      </li>
                    ))}
                    {!state.teams.length && (
                      <li className="card-brutal bg-[var(--dead)] p-3 text-sm">Stand up repos, then scan.</li>
                    )}
                  </ul>
                </div>
              )}
              {tab === "community" && (
                <div className="space-y-3">
                  <div className={`pane-head ${PANE.community.head}`}>
                    <h3 className="flex items-center gap-2 text-3xl">
                      <BrandMark brand="discord" size="lg" />
                      Discord
                    </h3>
                  </div>
                  <div className="card-brutal bg-[#fde8eb] p-4">
                    <p className="text-[15px] leading-relaxed">
                      Setup creates #supervisor plus per-agent rooms, onboarding, alerts, and private team channels.
                    </p>
                    {state.discord?.inviteUrl && (
                      <p className="mt-2 font-mono text-xs font-bold break-all">{state.discord.inviteUrl}</p>
                    )}
                  </div>
                  <ul className="flex flex-col gap-2">
                    {(state.discord?.teamChannels ?? []).map((c) => (
                      <li key={c.id} className="card-brutal bg-white px-3 py-2 text-sm">
                        #{c.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {tab === "interview" && (
                <div>
                  <div className={`pane-head ${PANE.interview.head}`}>
                    <h3 className="text-3xl">Rubrics</h3>
                  </div>
                  <ul className="flex flex-col gap-4">
                    {state.interviews
                      .slice()
                      .reverse()
                      .map((i) => (
                        <li key={i.id} className="card-brutal bg-[#f4eefb] p-3">
                          <p className="font-mono text-[10px] font-bold uppercase">
                            {new Date(i.ts).toLocaleString()} · {i.scoredBy ?? "unknown"}
                          </p>
                          {i.previewFrame && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt="Interview frame"
                              src={`data:image/jpeg;base64,${i.previewFrame}`}
                              className="hard-border mt-2 aspect-video w-full bg-black object-cover"
                            />
                          )}
                          {i.clipUrl && (
                            <video src={i.clipUrl} controls playsInline className="hard-border mt-2 aspect-video w-full bg-black" />
                          )}
                          <p className="mt-1 text-[15px] leading-relaxed">{i.summary}</p>
                          {i.scoreError && (
                            <p className="mt-1 text-xs font-bold uppercase">Fallback // {i.scoreError}</p>
                          )}
                          <p className="mt-2 font-mono text-xs font-bold uppercase">
                            script {i.scriptLikelihood.toFixed(2)} // eye {(i.eyeContactProxy ?? 0).toFixed(2)} //
                            read {(i.readingFromScript ?? 0).toFixed(2)} // {i.recommendAdvance ? "ADVANCE" : "HOLD"}
                          </p>
                        </li>
                      ))}
                    {!state.interviews.length && (
                      <li className="card-brutal bg-[var(--accent)] p-3 text-sm leading-relaxed">
                        Open the{" "}
                        <Link href="/interview" className="underline">
                          interview room
                        </Link>{" "}
                        for the 15s camera + voice screen.
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {tab === "board" && (
                <div>
                  <div className={`pane-head ${PANE.board.head}`}>
                    <h3 className="flex items-center gap-2 text-3xl">
                      <BrandMark brand="github" size="lg" />
                      Leaderboard
                    </h3>
                  </div>
                  <ol className="flex flex-col gap-3">
                    {board.map((row, index) => (
                      <li key={row.repo} className="card-brutal team-card p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="display text-2xl normal-case">
                            {index + 1}. {row.name}
                          </p>
                          <span className={healthTag(row.health)}>{row.health}</span>
                        </div>
                        <p className="mt-1 font-mono text-xs font-bold uppercase">
                          score {row.score}
                          {row.judgeScore != null ? ` · judge ${row.judgeScore}` : ""}
                          {row.scoredBy ? ` · interview ${row.scoredBy}` : " · no interview"}
                        </p>
                        <p className="mt-1 text-sm">{row.prizes.join(" · ") || "No sponsor match yet"}</p>
                      </li>
                    ))}
                    {!board.length && (
                      <li className="card-brutal bg-white p-3 text-sm">Scan GitHub to rank teams.</li>
                    )}
                  </ol>
                  {(state.judging ?? []).length > 0 && (
                    <div className="mt-6">
                      <p className="mb-3 font-mono text-[11px] font-bold uppercase">Criticizer · Promoter · Judge</p>
                      <ul className="flex flex-col gap-3">
                        {[...state.judging].reverse().map((round: JudgingRound) => (
                          <li key={round.id} className="card-brutal bg-[#fff8e8] p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="display text-xl normal-case">{round.teamName}</p>
                              <span className="tag tag-live">
                                {round.judge.score} · {round.judge.scoredBy}
                              </span>
                            </div>
                            <p className="mt-2 text-sm">
                              <span className="font-bold">Critic // </span>
                              {round.critic.summary}
                            </p>
                            <p className="mt-1 text-sm">
                              <span className="font-bold">Promoter // </span>
                              {round.promoter.summary}
                            </p>
                            <p className="mt-1 text-sm">
                              <span className="font-bold">Judge // </span>
                              {round.judge.rationale}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {tab === "ops" && (
                <div>
                  <div className={`pane-head ${PANE.ops.head}`}>
                    <h3 className="text-3xl">Agent traces</h3>
                  </div>
                  <p className="mb-4 font-mono text-[11px] font-bold uppercase">
                    {langfuse
                      ? "Langfuse: supervisor only (free tier) // workers stay in local jsonl"
                      : "Local agent-runs // add LANGFUSE keys to ship supervisor traces"}
                  </p>
                  <ol className="flex flex-col gap-3">
                    {traces.map((t) => (
                      <li key={t.id} className="card-brutal bg-[var(--accent-5)] p-3">
                        <p className="font-mono text-[10px] font-bold uppercase">
                          {new Date(t.ts).toLocaleString()} · {t.name} · {t.ok ? "ok" : "fail"}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed">{t.output}</p>
                        <p className="mt-1 font-mono text-[10px]">{t.input.slice(0, 160)}</p>
                      </li>
                    ))}
                    {!traces.length && (
                      <li className="card-brutal bg-[var(--dead)] p-3 text-sm">Run an agent to stamp traces.</li>
                    )}
                  </ol>
                </div>
              )}

              </div>
            </div>
          </div>
      </main>
      )}
    </div>
  );
}
