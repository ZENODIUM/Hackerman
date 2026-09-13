import "server-only";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { checkHealth } from "@/lib/agents/github";
import { env, geminiModel } from "@/lib/env";
import { addActivity, addJudging, getState, patchPipeline, upsertTeams } from "@/lib/store";
import type { Activity, InterviewRubric, JudgingRound, Team } from "@/lib/types";

function parseJsonObject(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

function latestInterview(team: Team): InterviewRubric | undefined {
  return [...getState().interviews]
    .reverse()
    .find((row) => row.teamId === team.name || row.teamId === team.id || row.teamId === team.repo);
}

function brief(team: Team, interview?: InterviewRubric): string {
  return [
    `Team ${team.name} (${team.repo})`,
    `Health: ${team.health} · commits ${team.commitCount} · last ${team.lastCommit ?? "never"}`,
    `Stack: ${team.stack.join(", ") || "unknown"}`,
    `Sponsor prizes: ${(team.prizes ?? []).join(", ") || "none"}`,
    `Notes: ${team.notes}`,
    interview
      ? `Interview (${interview.scoredBy}): advance=${interview.recommendAdvance} script=${interview.scriptLikelihood} ${interview.summary}`
      : "Interview: none",
  ].join("\n");
}

async function askGemini(system: string, user: string): Promise<Record<string, unknown> | null> {
  if (!env("GEMINI_API_KEY")) return null;
  try {
    const model = new ChatGoogleGenerativeAI({
      apiKey: env("GEMINI_API_KEY"),
      model: geminiModel(),
      temperature: 0.3,
    });
    const res = await model.invoke([
      { role: "system", content: `${system} Return ONLY JSON. No markdown.` },
      { role: "user", content: user },
    ]);
    const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    const parsed = parseJsonObject(text);
    return Object.keys(parsed).length ? parsed : null;
  } catch {
    return null;
  }
}

function heuristic(team: Team, interview?: InterviewRubric): Omit<JudgingRound, "id" | "ts" | "teamId" | "teamName" | "live"> {
  const flaws = [
    team.health === "stalled" ? "No recent commits — looks abandoned mid-hack." : "",
    team.health === "noisy" ? "High commit volume without a README — hard to review." : "",
    !team.stack.length ? "Stack could not be detected from the repo." : "",
    !interview ? "No authenticity interview on file." : "",
    interview && !interview.recommendAdvance ? "Interview recommended hold." : "",
  ].filter(Boolean);
  const strengths = [
    team.health === "healthy" ? "Healthy commit cadence with a readable repo." : "",
    team.prizes?.length ? `Hits sponsor tracks: ${team.prizes.join(", ")}.` : "",
    interview?.recommendAdvance ? "Interview recommended advance." : "",
    team.commitCount > 0 ? `${team.commitCount} recent commits to inspect.` : "",
  ].filter(Boolean);
  let score = team.health === "healthy" ? 72 : team.health === "noisy" ? 54 : team.health === "stalled" ? 28 : 40;
  score += Math.min(18, (team.prizes?.length ?? 0) * 4);
  if (interview?.recommendAdvance) score += 8;
  if (!flaws.length) score += 4;
  return {
    critic: { flaws, summary: flaws[0] ?? "No obvious blockers." },
    promoter: { strengths, summary: strengths[0] ?? "Still a shippable hackathon project." },
    judge: {
      score: Math.max(0, Math.min(100, score)),
      rationale: "Heuristic judge — Gemini unavailable or JSON failed. Weighted health, prizes, and interview.",
      scoredBy: "heuristic",
    },
  };
}

async function deliberate(team: Team): Promise<JudgingRound> {
  const interview = latestInterview(team);
  const packet = brief(team, interview);
  const fallback = heuristic(team, interview);

  const criticRaw = await askGemini(
    'You are the Criticizer. Find flaws in this hackathon project. JSON: {"flaws":string[],"summary":string}',
    packet,
  );
  const promoterRaw = await askGemini(
    'You are the Promoter. Argue for this hackathon project. JSON: {"strengths":string[],"summary":string}',
    packet,
  );

  const critic = {
    flaws: strings(criticRaw?.flaws).length ? strings(criticRaw?.flaws) : fallback.critic.flaws,
    summary: String(criticRaw?.summary ?? fallback.critic.summary),
  };
  const promoter = {
    strengths: strings(promoterRaw?.strengths).length ? strings(promoterRaw?.strengths) : fallback.promoter.strengths,
    summary: String(promoterRaw?.summary ?? fallback.promoter.summary),
  };

  const judgeRaw = await askGemini(
    'You are the GitHub Progress judge. Weigh critic flaws vs promoter strengths plus repo evidence. JSON: {"score":0-100,"rationale":string}',
    `${packet}\n\nCRITIC: ${JSON.stringify(critic)}\nPROMOTER: ${JSON.stringify(promoter)}`,
  );
  const score = Number(judgeRaw?.score);
  const judge = Number.isFinite(score)
    ? {
        score: Math.max(0, Math.min(100, Math.round(score))),
        rationale: String(judgeRaw?.rationale ?? fallback.judge.rationale),
        scoredBy: "gemini" as const,
      }
    : fallback.judge;

  const live = criticRaw != null && promoterRaw != null && Number.isFinite(score);
  return addJudging({
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    teamId: team.id,
    teamName: team.name,
    critic,
    promoter,
    judge,
    live,
  });
}

export async function runJudging(): Promise<{ rounds: JudgingRound[]; activity: Activity }> {
  const health = await checkHealth();
  const rounds: JudgingRound[] = [];
  for (const team of health.teams) {
    const round = await deliberate(team);
    rounds.push(round);
    upsertTeams([{ ...team, judgeScore: round.judge.score, notes: `${team.notes} / Judge ${round.judge.score}` }]);
  }
  patchPipeline({ judged: true });
  const activity = addActivity({
    agent: "progress",
    title: "Judging complete",
    detail: rounds.map((r) => `${r.teamName}: ${r.judge.score} (${r.judge.scoredBy})`).join(" · ") || "No teams to judge.",
    ok: rounds.length > 0,
    payload: { live: rounds.some((r) => r.live), rounds: rounds.map((r) => ({ team: r.teamName, score: r.judge.score })) },
  });
  return { rounds, activity };
}
