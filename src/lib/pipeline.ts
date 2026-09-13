import "server-only";

import { ensureGuildSetup, ensureTeamChannels, onboardAttendees } from "@/lib/agents/discord";
import { addIntakeQuestions, createFreeTicket, createPrivateEvent, publishEvent, syncAttendees } from "@/lib/agents/eventbrite";
import { checkHealth, ensureRepos } from "@/lib/agents/github";
import { genericBrief } from "@/lib/hackathon";
import { sendWelcomeEmails } from "@/lib/agents/resend";
import { logAgentRun } from "@/lib/logger";
import { addActivity, getState } from "@/lib/store";
import type { Activity } from "@/lib/types";

async function step(title: string, fn: () => Promise<Activity | { activity: Activity }>): Promise<Activity> {
  try {
    const result = await fn();
    return "activity" in result ? result.activity : result;
  } catch (err) {
    return addActivity({
      agent: "supervisor",
      title: `${title} failed`,
      detail: err instanceof Error ? err.message : String(err),
      ok: false,
    });
  }
}

export async function runStandUp(): Promise<{ reply: string; activities: Activity[] }> {
  const activities: Activity[] = [];
  activities.push(
    await step("Create Eventbrite event", () => createPrivateEvent(getState().brief?.name ?? genericBrief().name)),
  );
  activities.push(await step("Create free ticket", () => createFreeTicket()));
  activities.push(await step("Intake questions", () => addIntakeQuestions()));
  activities.push(await step("Publish event", () => publishEvent()));
  activities.push(await step("Discord guild setup", () => ensureGuildSetup()));
  activities.push(await step("Create GitHub repos", () => ensureRepos()));
  activities.push(await step("Team Discord channels", () => ensureTeamChannels()));
  const sync = await step("Sync attendees", () => syncAttendees());
  activities.push(sync);
  activities.push(await step("Discord onboard", () => onboardAttendees()));
  activities.push(await step("GitHub health scan", () => checkHealth()));
  activities.push(await step("Welcome emails", () => sendWelcomeEmails()));

  const ok = activities.filter((a) => a.ok).length;
  const fail = activities.filter((a) => !a.ok).length;
  logAgentRun({
    node: "pipeline",
    user_prompt: "stand up hackathon",
    summary: `${ok} steps ok, ${fail} failed`,
    ok: fail === 0,
    payload: { titles: activities.map((a) => a.title) },
  });
  return {
    reply: activities.map((a) => `${a.ok ? "OK" : "FAIL"} ${a.title}: ${a.detail}`).join("\n"),
    activities,
  };
}
