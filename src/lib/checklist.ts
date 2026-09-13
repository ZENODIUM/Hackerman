import "server-only";

import type { Activity, AppState, ChecklistItem, ChecklistSource, ChecklistStatus } from "@/lib/types";

function payloadLive(activity?: Activity): boolean | undefined {
  if (!activity || activity.payload == null || typeof activity.payload !== "object") return undefined;
  const live = (activity.payload as { live?: unknown }).live;
  if (typeof live === "boolean") return live;
  return undefined;
}

function latestMatch(state: AppState, re: RegExp): Activity | undefined {
  return [...state.activities].reverse().find((a) => re.test(a.title) || re.test(a.detail));
}

function sourceOf(activity: Activity | undefined, extras?: { liveHint?: boolean }): ChecklistSource {
  const flagged = payloadLive(activity);
  if (flagged === true) return "live";
  if (flagged === false) return "fixture";
  if (activity && /fixture|dry run/i.test(activity.title)) return "fixture";
  if (activity && /created private eventbrite|created free ticket|published eventbrite|discord guild setup|created github/i.test(activity.title)) {
    return "live";
  }
  if (extras?.liveHint) return "live";
  if (activity) return "unknown";
  return "unknown";
}

function activityHit(state: AppState, re: RegExp, okOnly = true) {
  return state.activities.some(
    (a) => (!okOnly || a.ok) && (re.test(a.title) || re.test(a.detail)),
  );
}

function statusFor(done: boolean, started: boolean, firstIncomplete: boolean): ChecklistStatus {
  if (done) return "done";
  if (started || firstIncomplete) return "pending";
  return "todo";
}

export function deriveChecklist(state: AppState): ChecklistItem[] {
  const p = state.pipeline ?? {};
  const specs: {
    id: ChecklistItem["id"];
    label: string;
    done: boolean;
    detail?: string;
    match: RegExp;
    liveHint?: boolean;
  }[] = [
    {
      id: "eventCreated",
      label: "Eventbrite event created",
      done: Boolean(p.eventCreated || state.eventId) || activityHit(state, /created private eventbrite/i),
      detail: state.eventId ? `Event ${state.eventId}` : undefined,
      match: /created private eventbrite|eventbrite event reused/i,
      liveHint: Boolean(state.eventId),
    },
    {
      id: "ticketCreated",
      label: "Free ticket class created",
      done: Boolean(p.ticketCreated) || activityHit(state, /ticket class/i),
      match: /ticket class/i,
    },
    {
      id: "attendeesSynced",
      label: "Attendees synced",
      done: Boolean(p.attendeesSynced || state.attendees.length) || activityHit(state, /eventbrite (sync|fixture)/i),
      detail: `${state.attendees.length} attendee(s)`,
      match: /eventbrite (sync|fixture)/i,
    },
    {
      id: "discordSetup",
      label: "Discord channels + roles",
      done: Boolean(p.discordSetup || state.discord?.onboardingChannelId) || activityHit(state, /discord guild setup/i),
      detail: state.discord?.inviteUrl,
      match: /discord guild setup/i,
      liveHint: Boolean(state.discord?.onboardingChannelId),
    },
    {
      id: "discordOnboarded",
      label: "Discord onboarding posted",
      done: Boolean(p.discordOnboarded) || activityHit(state, /discord onboard/i),
      match: /discord onboard/i,
    },
    {
      id: "teamChannelsCreated",
      label: "Team Discord channels",
      done: Boolean(p.teamChannelsCreated || (state.discord?.teamChannels?.length ?? 0) > 0),
      detail: state.discord?.teamChannels?.map((c) => c.name).join(", "),
      match: /team discord channels/i,
      liveHint: Boolean(state.discord?.teamChannels?.length),
    },
    {
      id: "githubReposCreated",
      label: "GitHub team repos",
      done: Boolean(p.githubReposCreated) || activityHit(state, /github repo/i),
      match: /github repo/i,
    },
    {
      id: "githubScanned",
      label: "GitHub health scan",
      done: Boolean(p.githubScanned || state.teams.length) || activityHit(state, /github (health|fixture) scan/i),
      detail: state.teams.map((t) => `${t.name}:${t.health}`).join(" / ") || undefined,
      match: /github (health|fixture) scan/i,
    },
    {
      id: "emailsSent",
      label: "Welcome emails",
      done: Boolean(p.emailsSent) || activityHit(state, /welcome email/i),
      match: /welcome email/i,
    },
    {
      id: "interviewDone",
      label: "AI interview scored",
      done: Boolean(p.interviewDone || state.interviews.length) || activityHit(state, /interview:/i),
      detail: state.interviews.length ? `${state.interviews.length} rubric(s)` : undefined,
      match: /interview:/i,
      liveHint: state.interviews.some((i) => i.scoredBy === "gemini"),
    },
  ];

  const firstIncomplete = specs.find((row) => !row.done)?.id;

  return specs.map((row) => ({
    id: row.id,
    label: row.label,
    done: row.done,
    detail: row.detail,
    source: sourceOf(latestMatch(state, row.match), { liveHint: row.liveHint }),
    status: statusFor(row.done, activityHit(state, row.match, false), row.id === firstIncomplete),
  }));
}
