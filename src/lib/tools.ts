import "server-only";

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { answerSupport, ensureGuildSetup, ensureTeamChannels, handoffFromGithub, matchmake, nudgeStalled, onboardAttendees, postLeaderboard, postTimeline } from "@/lib/agents/discord";
import { addIntakeQuestions, createFreeTicket, createPrivateEvent, extendEventSales, flagLowCapacity, listUnregisteredInvitees, publishEvent, syncAttendees } from "@/lib/agents/eventbrite";
import { checkHealth, ensureRepos, openIssue, remindSponsors } from "@/lib/agents/github";
import { runInterview } from "@/lib/agents/interview";
import { runJudging } from "@/lib/agents/judge";
import { sendWelcomeEmails } from "@/lib/agents/resend";

function dump(value: unknown) {
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    const activity = (row.activity ?? row) as { title?: string; detail?: string; ok?: boolean; payload?: { live?: boolean } };
    if (activity.title && activity.detail) {
      return JSON.stringify({
        title: activity.title,
        detail: activity.detail,
        ok: activity.ok,
        live: activity.payload?.live ?? row.live,
        stalled: row.stalled,
        sent: (activity.payload as { sent?: number } | undefined)?.sent,
      });
    }
  }
  return JSON.stringify(value);
}

export const eventbriteTools = [
  tool(
    async ({ name }) => dump(await createPrivateEvent(name)),
    {
      name: "create_eventbrite_event",
      description: "Create an Eventbrite event from the current hackathon brief, or reopen sales if the stored event already ended.",
      schema: z.object({ name: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await extendEventSales()),
    {
      name: "reopen_eventbrite_sales",
      description: "Extend Eventbrite start/end dates and ticket sales so registration is open again.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await createFreeTicket()),
    {
      name: "create_free_ticket",
      description: "Add a free Hacker ticket class to the current Eventbrite event.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await addIntakeQuestions()),
    {
      name: "add_intake_questions",
      description: "Add Discord and GitHub username questions to the Eventbrite event.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await publishEvent()),
    {
      name: "publish_event",
      description: "Publish the Eventbrite event if the API allows it.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await syncAttendees()),
    {
      name: "sync_attendees",
      description: "Pull Eventbrite attendees into the Hackerman store.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await sendWelcomeEmails()),
    {
      name: "send_welcome_emails",
      description: "Email attendees a Discord invite and Meet link via Resend.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await flagLowCapacity()),
    {
      name: "flag_low_capacity",
      description: "Check Eventbrite ticket remaining vs sold and flag low capacity.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await listUnregisteredInvitees()),
    {
      name: "list_unregistered_invitees",
      description: "List Eventbrite attendees missing Discord/GitHub, or an empty live event.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
];

export const githubTools = [
  tool(
    async () => dump(await ensureRepos()),
    {
      name: "ensure_github_repos",
      description: "Create team-healthy, team-stalled, and team-noisy repos under GITHUB_OWNER if missing.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await checkHealth()),
    {
      name: "check_github_health",
      description: "Scan team repos for stalled / noisy / healthy commit patterns.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async ({ repo, title, body }) => dump(await openIssue(repo, title, body)),
    {
      name: "open_github_issue",
      description: "Open a GitHub issue on a team repo.",
      schema: z.object({
        repo: z.string(),
        title: z.string(),
        body: z.string(),
      }),
    },
  ),
  tool(
    async () => dump(await remindSponsors()),
    {
      name: "remind_sponsors",
      description: "Match team stacks to sponsor prize tracks.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await runJudging()),
    {
      name: "judge_projects",
      description: "Criticizer + promoter debate, then the Progress agent scores each team 0-100.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
];

export const discordTools = [
  tool(
    async () => dump(await ensureGuildSetup()),
    {
      name: "setup_discord_guild",
      description: "Create Hackerman category, per-agent channels, onboarding/alerts, and Hacker/Stalled roles.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await ensureTeamChannels()),
    {
      name: "create_team_channels",
      description: "Create private Discord channels for each team repo.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await onboardAttendees()),
    {
      name: "onboard_attendees",
      description: "Post the Eventbrite attendee list to Discord onboarding and assign Hacker roles.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await nudgeStalled()),
    {
      name: "nudge_stalled_teams",
      description: "Post a stall alert to Discord #alerts.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async ({ message }) => dump(await postTimeline(message)),
    {
      name: "post_timeline",
      description: "Post a timeline announcement in Discord.",
      schema: z.object({ message: z.string() }),
    },
  ),
  tool(
    async ({ question }) => dump(await answerSupport(question)),
    {
      name: "answer_support",
      description: "Answer a hacker FAQ or escalate to mentors.",
      schema: z.object({ question: z.string() }),
    },
  ),
  tool(
    async () => dump(await matchmake()),
    {
      name: "matchmake_solos",
      description: "Post solo hackers looking for teammates.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await handoffFromGithub()),
    {
      name: "handoff_stalled_from_github",
      description: "ONE call: ask Progress to scan GitHub, then post a stall nudge to #alerts. Do not call this twice.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
  tool(
    async () => dump(await postLeaderboard()),
    {
      name: "post_leaderboard",
      description: "ONE call: refresh GitHub health and post the leaderboard to #announcements. Do not call other tools after this.",
      schema: z.object({ note: z.string().optional() }),
    },
  ),
];

export const interviewTools = [
  tool(
    async ({ transcript, teamId }) => dump(await runInterview({ transcript, teamId })),
    {
      name: "score_interview",
      description: "Score a text interview transcript for authenticity. Camera interviews use the /interview room.",
      schema: z.object({
        transcript: z.string(),
        teamId: z.string().optional(),
      }),
    },
  ),
];
