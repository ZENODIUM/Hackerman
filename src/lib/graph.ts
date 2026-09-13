import "server-only";

import { HumanMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ensureGuildSetup, ensureTeamChannels, handoffFromGithub, matchmake, onboardAttendees, postLeaderboard, postTimeline, answerSupport } from "@/lib/agents/discord";
import { addIntakeQuestions, createFreeTicket, createPrivateEvent, extendEventSales, flagLowCapacity, listUnregisteredInvitees, publishEvent, syncAttendees } from "@/lib/agents/eventbrite";
import { checkHealth, ensureRepos, openIssue, remindSponsors } from "@/lib/agents/github";
import { runInterview } from "@/lib/agents/interview";
import { runJudging } from "@/lib/agents/judge";
import { sendWelcomeEmails } from "@/lib/agents/resend";
import { env, geminiModel } from "@/lib/env";
import { logAgentRun } from "@/lib/logger";
import { briefComplete, formatBrief, genericBrief, looksLikeBrief, parseBriefFromText, SETUP_PROMPT, wantsDefaults } from "@/lib/hackathon";
import { runStandUp } from "@/lib/pipeline";
import { getState, addActivity, setSetupPending, updateBrief } from "@/lib/store";
import { discordTools, eventbriteTools, githubTools, interviewTools } from "@/lib/tools";
import type { Activity } from "@/lib/types";

export const GraphState = Annotation.Root({
  userPrompt: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  next: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "finish",
  }),
  hops: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),
  stalled: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),
  forceHandoff: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),
  force: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  activities: Annotation<Activity[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  reply: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
});

export type GraphStateType = typeof GraphState.State;

const WORKERS = ["eventbrite", "github", "discord", "interview", "pipeline", "judge", "finish"] as const;

function keywordRoute(prompt: string): (typeof WORKERS)[number] {
  const p = prompt.toLowerCase();
  if (/(stand ?up|pipeline|bootstrap|create everything|full (run|setup)|start the hackathon)/.test(p)) {
    return "pipeline";
  }
  if (/(judge|judging|critic|promoter|deliberat|score (the )?project)/.test(p)) return "judge";
  if (/(interview|authenticity|screen|eye contact)/.test(p)) return "interview";
  if (/(stuck|stall|github|commit|progress|sponsor|pre-?screen|repo)/.test(p)) return "github";
  if (/(discord|onboard|nudge|support|timeline|teammate|match|channel|role|leaderboard)/.test(p)) return "discord";
  if (/(sales ended|reopen|extend (sales|event|dates))/.test(p)) return "eventbrite";
  if (/(eventbrite|register|attendee|email|resend|meet|create event|ticket|capacit|invitee)/.test(p)) return "eventbrite";
  return "eventbrite";
}

function lastMessageText(messages: { content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => (typeof part === "string" ? part : (part as { text?: string }).text ?? ""))
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

const AGENT_FOR_NODE: Record<string, Activity["agent"]> = {
  eventbrite: "registration",
  github: "progress",
  discord: "community",
  interview: "interview",
};

async function runToolAgent(
  name: string,
  tools: StructuredToolInterface[],
  prompt: string,
  system: string,
): Promise<string | null> {
  if (!env("GEMINI_API_KEY")) return null;
  const before = getState().activities.length;
  try {
    const llm = new ChatGoogleGenerativeAI({
      apiKey: env("GEMINI_API_KEY"),
      model: geminiModel(),
      temperature: 0,
    });
    const agent = createReactAgent({
      llm,
      tools,
      prompt: `${system}\n\nHard rules: call at most 3 tools. Never call the same tool twice. After tools return, stop and summarize in 3 short sentences. Do not keep verifying.`,
    });
    const result = await agent.invoke(
      {
        messages: [
          new HumanMessage(
            `${prompt}\n\nUse the fewest tools that complete the request, then stop.`,
          ),
        ],
      },
      { recursionLimit: 8 },
    );
    const text = lastMessageText(result.messages ?? []);
    const created = getState().activities.slice(before);
    logAgentRun({
      node: `${name}:tools`,
      user_prompt: prompt,
      summary: text || created.map((a) => a.title).join(", ") || "tool agent finished",
      ok: true,
      payload: { tools: created.map((a) => a.title) },
    });
    return text || created.map((a) => a.detail).join(" ");
  } catch (err) {
    const created = getState().activities.slice(before);
    const message = err instanceof Error ? err.message : "tool agent failed";
    addActivity({
      agent: AGENT_FOR_NODE[name] ?? "supervisor",
      title: `${name} tools failed`,
      detail: message,
      ok: false,
      payload: { live: false, recursion: /recursion limit/i.test(message) },
    });
    logAgentRun({
      node: `${name}:tools`,
      user_prompt: prompt,
      summary: message,
      ok: false,
    });
    if (created.length) return created.map((a) => a.detail).join(" ");
    return null;
  }
}

async function supervisorNode(state: GraphStateType) {
  if (state.hops >= 4) {
    return { next: "finish", reply: state.reply || "Done." };
  }

  if (getState().setupPending && !state.force) {
    if (!looksLikeBrief(state.userPrompt) && !wantsDefaults(state.userPrompt)) {
      const activity = addActivity({
        agent: "supervisor",
        title: "Brief still needed",
        detail: SETUP_PROMPT,
        ok: true,
      });
      return { next: "finish", reply: SETUP_PROMPT, activities: [activity] };
    }
    const intake = await ensureBrief(state.userPrompt);
    if (intake.ready) {
      return { next: "pipeline", hops: state.hops + 1, activities: intake.activities };
    }
    return { next: "finish", reply: intake.reply ?? SETUP_PROMPT, activities: intake.activities };
  }

  let next = state.force && WORKERS.includes(state.force as (typeof WORKERS)[number])
    ? (state.force as (typeof WORKERS)[number])
    : keywordRoute(state.userPrompt);

  if (!state.force && env("GEMINI_API_KEY") && next !== "pipeline") {
    try {
      const model = new ChatGoogleGenerativeAI({
        apiKey: env("GEMINI_API_KEY"),
        model: geminiModel(),
        temperature: 0,
      });
      const res = await model.invoke([
        {
          role: "system",
          content:
            "You are the Hackathon Supervisor. Reply with ONE word only: pipeline, eventbrite, github, discord, interview, judge, or finish. Use pipeline for stand-up / create everything. Use judge for criticizer + promoter + GitHub judge scoring. After github, if teams are stalled the graph hands off to discord.",
        },
        { role: "user", content: state.userPrompt },
      ]);
      const text = String(res.content).toLowerCase();
      const hit = WORKERS.find((w) => text.includes(w));
      if (hit) next = hit;
    } catch {
      /* keep keyword route */
    }
  }

  const activity = addActivity({
    agent: "supervisor",
    title: `Routing → ${next}`,
    detail: `Supervisor chose ${next} for: ${state.userPrompt.slice(0, 140)}`,
    ok: true,
  });
  logAgentRun({
    node: "supervisor",
    user_prompt: state.userPrompt,
    summary: `Routed to ${next}`,
    ok: true,
    payload: { force: state.force || null },
  });
  return { next, hops: state.hops + 1, activities: [activity] };
}

async function ensureBrief(prompt: string, force?: string): Promise<{ ready: boolean; reply?: string; activities: Activity[] }> {
  const state = getState();
  const standup = force === "pipeline" || /(stand ?up|pipeline|create everything|start the hackathon)/i.test(prompt);
  const pending = Boolean(state.setupPending) || !briefComplete(state.brief, state.briefConfirmed);

  if (!pending) return { ready: true, activities: [] };

  if (wantsDefaults(prompt) || (standup && /generic|default/i.test(prompt))) {
    const brief = genericBrief();
    updateBrief(brief);
    setSetupPending(false);
    const activity = addActivity({
      agent: "supervisor",
      title: "Brief filled with generic data",
      detail: formatBrief(brief),
      ok: true,
    });
    return { ready: true, activities: [activity] };
  }

  if (state.setupPending && !standup) {
    const brief = parseBriefFromText(prompt, state.brief ?? genericBrief());
    updateBrief(brief);
    setSetupPending(false);
    const activity = addActivity({
      agent: "supervisor",
      title: "Hackathon brief saved",
      detail: formatBrief(brief),
      ok: true,
    });
    return {
      ready: true,
      reply: `Saved this brief:\n${formatBrief(brief)}`,
      activities: [activity],
    };
  }

  setSetupPending(true);
  const activity = addActivity({
    agent: "supervisor",
    title: "Asking organizer for hackathon brief",
    detail: SETUP_PROMPT,
    ok: true,
  });
  return { ready: false, reply: SETUP_PROMPT, activities: [activity] };
}

async function pipelineNode(state: GraphStateType) {
  const intake = await ensureBrief(state.userPrompt, state.force);
  if (!intake.ready) {
    return { activities: intake.activities, reply: intake.reply ?? SETUP_PROMPT, next: "finish" };
  }
  const result = await runStandUp();
  const prefix = intake.activities.length ? `${intake.activities.map((a) => a.detail).join("\n")}\n\n` : "";
  return {
    activities: [...intake.activities, ...result.activities],
    reply: `${prefix}${result.reply}`,
    next: "finish",
  };
}

async function eventbriteNode(state: GraphStateType) {
  const p = state.userPrompt.toLowerCase();
  const viaTools = await runToolAgent(
    "eventbrite",
    eventbriteTools,
    state.userPrompt,
    "You are the Registration agent. Tools: create Eventbrite events/tickets, sync attendees, send Resend welcome emails, flag low ticket capacity, list incomplete/unregistered invitees.",
  );
  if (viaTools) {
    return { activities: [], reply: viaTools, next: "finish" };
  }

  const acts: Activity[] = [];
  if (/(sales ended|reopen|extend (sales|event|dates))/.test(p)) {
    acts.push((await extendEventSales()).activity);
    return { activities: acts, reply: acts.map((a) => a.detail).join(" "), next: "finish" };
  }
  if (/(create event|stand ?up|ticket)/.test(p)) {
    acts.push((await createPrivateEvent(getState().brief?.name)).activity);
    acts.push((await createFreeTicket()).activity);
    acts.push(await addIntakeQuestions());
    acts.push(await publishEvent());
  }
  if (/(capacit|ticket remaining|sold out)/.test(p)) {
    acts.push((await flagLowCapacity()).activity);
    return { activities: acts, reply: acts.map((a) => a.detail).join(" "), next: "finish" };
  }
  if (/(unregister|invitee|incomplete intake|missing discord)/.test(p)) {
    acts.push((await listUnregisteredInvitees()).activity);
    return { activities: acts, reply: acts.map((a) => a.detail).join(" "), next: "finish" };
  }
  const sync = await syncAttendees();
  acts.push(sync.activity);
  if (/(email|resend|meet)/.test(p)) {
    acts.push((await sendWelcomeEmails()).activity);
  }
  if (/(onboard|discord|sync|attendee)/.test(p)) {
    acts.push((await onboardAttendees(sync.attendees)).activity);
  }
  logAgentRun({
    node: "eventbrite",
    user_prompt: state.userPrompt,
    summary: acts.map((a) => a.title).join(", "),
    ok: true,
  });
  return { activities: acts, reply: acts.map((a) => a.detail).join(" "), next: "finish" };
}

async function githubNode(state: GraphStateType) {
  const p = state.userPrompt.toLowerCase();
  const viaTools = await runToolAgent(
    "github",
    githubTools,
    state.userPrompt,
    "You are the Progress agent. Create team repos if needed, scan health, open stall issues, match sponsor tools, and run criticizer/promoter judging.",
  );
  if (viaTools) {
    const stalled = getState().teams.filter((t) => t.health === "stalled").map((t) => t.repo);
    const judged = /judg/i.test(viaTools);
    return {
      activities: [],
      reply: viaTools,
      stalled,
      forceHandoff: !judged && stalled.length > 0,
      next: !judged && stalled.length ? "discord" : "finish",
    };
  }

  const acts: Activity[] = [];
  if (/(judge|critic|promoter|deliberat)/.test(p)) {
    acts.push((await runJudging()).activity);
    return { activities: acts, reply: acts.map((a) => a.detail).join(" "), next: "finish" };
  }
  if (/(create|repo|stand ?up)/.test(p)) {
    acts.push((await ensureRepos()).activity);
  }
  const health = await checkHealth();
  acts.push(health.activity);
  acts.push(await remindSponsors(health.teams));
  for (const team of health.teams.filter((t) => t.health === "stalled")) {
    acts.push(
      await openIssue(
        team.repo,
        `Stall check: ${team.name}`,
        `${team.notes}\n\nOpened by Hackerman Progress agent.`,
      ),
    );
  }
  logAgentRun({
    node: "github",
    user_prompt: state.userPrompt,
    summary: health.activity.detail,
    ok: true,
    payload: { stalled: health.stalled, live: health.live },
  });
  return {
    activities: acts,
    stalled: health.stalled,
    forceHandoff: health.stalled.length > 0,
    reply: health.activity.detail,
    next: health.stalled.length ? "discord" : "finish",
  };
}

async function discordNode(state: GraphStateType) {
  const p = state.userPrompt.toLowerCase();
  const viaTools = await runToolAgent(
    "discord",
    discordTools,
    state.userPrompt,
    "You are the Community agent. For stuck/stalled teams call handoff_stalled_from_github once. For ranks call post_leaderboard once. Do not call check tools separately — those composites already talk to GitHub.",
  );
  if (viaTools) {
    return { activities: [], reply: viaTools, forceHandoff: false, next: "finish" };
  }

  const acts: Activity[] = [];
  if (/(setup|stand ?up|channel|role|create)/.test(p) || !getState().discord?.onboardingChannelId) {
    acts.push((await ensureGuildSetup()).activity);
    acts.push((await ensureTeamChannels()).activity);
  }
  if (/(leaderboard|rank|announce score)/.test(p)) {
    acts.push(await postLeaderboard());
    return { activities: acts, reply: acts.map((a) => a.detail).join(" "), next: "finish" };
  }
  if (state.forceHandoff || /(stuck|nudge|stall|github)/.test(p)) {
    acts.push((await handoffFromGithub()).activity);
  } else if (/(support|help|wifi|faq)/.test(p)) {
    acts.push(await answerSupport(state.userPrompt));
  } else if (/(timeline|announce)/.test(p)) {
    acts.push(await postTimeline(state.userPrompt));
  } else if (/(match|teammate)/.test(p)) {
    acts.push(await matchmake());
  } else {
    acts.push((await onboardAttendees()).activity);
  }
  logAgentRun({
    node: "discord",
    user_prompt: state.userPrompt,
    summary: acts.map((a) => a.title).join(", "),
    ok: true,
  });
  return {
    activities: acts,
    forceHandoff: false,
    reply: acts.map((a) => a.detail).join(" "),
    next: "finish",
  };
}

async function interviewNode(state: GraphStateType) {
  const viaTools = await runToolAgent(
    "interview",
    interviewTools,
    state.userPrompt,
    "You are the Interview agent. Score a transcript if the user pasted one. Otherwise tell them to open /interview for the 15s camera+voice screen.",
  );
  if (viaTools) {
    return { activities: [], reply: viaTools, next: "finish" };
  }

  const stripped = state.userPrompt.replace(/^.*interview[:\s-]*/i, "").trim();
  const looksLikeTranscript = stripped.length > 80 && !/^(run|start|open)/i.test(stripped);
  if (!looksLikeTranscript) {
    const activity = addActivity({
      agent: "interview",
      title: "Interview room",
      detail: "Open /interview — 15 second camera + voice Gemini question, then authenticity scoring on the recording.",
      ok: true,
    });
    return { activities: [activity], reply: activity.detail, next: "finish" };
  }
  const { rubric, activity } = await runInterview({ transcript: stripped });
  logAgentRun({
    node: "interview",
    user_prompt: state.userPrompt,
    summary: rubric.summary,
    ok: true,
    payload: rubric,
  });
  return { activities: [activity], reply: activity.detail, next: "finish" };
}

async function judgeNode() {
  const result = await runJudging();
  logAgentRun({
    node: "judge",
    user_prompt: "judge projects",
    summary: result.activity.detail,
    ok: result.activity.ok,
  });
  return {
    activities: [result.activity],
    reply: result.activity.detail,
    next: "finish",
  };
}

function compileGraph() {
  return new StateGraph(GraphState)
    .addNode("supervisor", supervisorNode)
    .addNode("eventbrite", eventbriteNode)
    .addNode("github", githubNode)
    .addNode("discord", discordNode)
    .addNode("interview", interviewNode)
    .addNode("pipeline", pipelineNode)
    .addNode("judge", judgeNode)
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", (s) => s.next, {
      eventbrite: "eventbrite",
      github: "github",
      discord: "discord",
      interview: "interview",
      pipeline: "pipeline",
      judge: "judge",
      finish: END,
    })
    .addConditionalEdges("github", (s) => (s.forceHandoff ? "discord" : "finish"), {
      discord: "discord",
      finish: END,
    })
    .addEdge("eventbrite", END)
    .addEdge("discord", END)
    .addEdge("interview", END)
    .addEdge("pipeline", END)
    .addEdge("judge", END)
    .compile();
}

let compiled: ReturnType<typeof compileGraph> | null = null;

export function getGraph() {
  compiled ??= compileGraph();
  return compiled;
}

export async function runSupervisor(userPrompt: string, force?: string) {
  const graph = getGraph();
  const result = await graph.invoke(
    {
      userPrompt,
      hops: 0,
      activities: [],
      stalled: [],
      forceHandoff: false,
      force: force ?? "",
    },
    { recursionLimit: 16 },
  );
  return result;
}
