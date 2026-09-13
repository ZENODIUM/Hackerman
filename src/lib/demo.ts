import "server-only";

import { runSupervisor } from "@/lib/graph";
import { logAgentRun } from "@/lib/logger";
import type { Activity } from "@/lib/types";

export const DEMO_STEPS = ["pipeline", "sync", "stuck", "nudge", "email", "interview"] as const;
export type DemoStep = (typeof DEMO_STEPS)[number];

const CHIP_PROMPTS: Record<Exclude<DemoStep, "interview">, { message: string; force?: string }> = {
  pipeline: {
    message:
      "Stand up the full hackathon: create the Eventbrite event and free ticket, Discord channels and roles, GitHub team repos, onboard attendees, and scan team health.",
    force: "pipeline",
  },
  sync: {
    message: "Sync Eventbrite attendees and onboard them on Discord.",
    force: "eventbrite",
  },
  stuck: {
    message: "Are any teams stuck? Check GitHub health and hand stalled teams to Discord.",
    force: "github",
  },
  nudge: {
    message: "Nudge stalled teams on Discord.",
    force: "discord",
  },
  email: {
    message: "Send welcome emails with the Discord invite and Meet link.",
    force: "eventbrite",
  },
};

export async function runDemoStep(step: DemoStep): Promise<{
  reply: string;
  activities: Activity[];
  redirect?: string;
}> {
  if (step === "interview") {
    logAgentRun({
      node: "demo:interview",
      user_prompt: "interview chip",
      summary: "Redirect to /interview for the 15s camera screen",
      ok: true,
    });
    return {
      reply: "Open the interview room for the 15-second camera + voice Gemini screen.",
      activities: [],
      redirect: "/interview",
    };
  }
  const spec = CHIP_PROMPTS[step];
  const result = await runSupervisor(spec.message, spec.force);
  return {
    reply: result.reply || "Done.",
    activities: result.activities ?? [],
  };
}
