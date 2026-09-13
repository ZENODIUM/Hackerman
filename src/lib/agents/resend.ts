import "server-only";

import { env } from "@/lib/env";
import { discordId } from "@/lib/ids";
import { addActivity, getState, patchPipeline, setMeta } from "@/lib/store";
import type { Activity } from "@/lib/types";

const SANDBOX_FROM = "Hackerman <onboarding@resend.dev>";

export function meetUrl(): string {
  return getState().meetUrl ?? env("MEET_FALLBACK_URL") ?? "https://meet.google.com/new";
}

function fromAddress(): string {
  const from = env("RESEND_FROM");
  if (!from || /@example\.com\b/i.test(from)) return SANDBOX_FROM;
  return from;
}

function emailOf(from: string): string {
  return (from.match(/<([^>]+)>/) || [null, from])[1] ?? from;
}

function isSandboxFrom(from: string): boolean {
  return /@resend\.dev$/i.test(emailOf(from));
}

export async function sendWelcomeEmails(): Promise<{ activity: Activity; live: boolean }> {
  const state = getState();
  const key = env("RESEND_API_KEY");
  const from = fromAddress();
  const live = Boolean(key);
  const sandbox = isSandboxFrom(from);
  const link = meetUrl();
  const invite = discordId("inviteUrl") ?? env("DISCORD_INVITE_URL") ?? "(Discord invite pending)";
  const sentIds: string[] = [];
  let skippedExample = 0;

  const recipients: { name: string; email: string }[] = [];
  if (sandbox) {
    const account = env("RESEND_TEST_TO");
    if (account) {
      recipients.push({ name: state.attendees[0]?.name ?? "Organizer", email: account });
    }
  } else {
    for (const person of state.attendees) {
      if (!person.email || person.email.endsWith("@example.com")) {
        if (person.email?.endsWith("@example.com")) skippedExample += 1;
        continue;
      }
      recipients.push({ name: person.name, email: person.email });
    }
  }

  if (live) {
    for (const person of recipients) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [person.email],
          subject: `You're in: ${state.eventName ?? "Hackerman"}`,
          html: `<p>Hey ${person.name},</p>
<p>You're registered. Join Discord: ${invite}</p>
<p>Kickoff Meet: <a href="${link}">${link}</a></p>
${sandbox ? "<p><em>Sent via Resend sandbox (onboarding@resend.dev) to the account inbox. Swap RESEND_FROM to your verified domain after the hackathon.</em></p>" : ""}`,
        }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { id?: string };
      if (json.id) sentIds.push(json.id);
    }
  }

  if (!getState().meetUrl) setMeta({ meetUrl: link });
  patchPipeline({ emailsSent: true });

  const sent = sentIds.length;
  const activity = addActivity({
    agent: "registration",
    title: live ? `Sent ${sent} welcome email(s)` : "Welcome email (dry run)",
    detail: live
      ? sandbox
        ? `Resend sandbox delivered ${sent} message(s) from onboarding@resend.dev to the account inbox. Meet ${link}.`
        : `Resend delivered ${sent} message(s) with Meet ${link}.${skippedExample ? ` Skipped ${skippedExample} @example.com.` : ""}`
      : `Would email ${state.attendees.length} attendee(s) via Resend with Meet ${link}. Add RESEND_API_KEY.`,
    ok: true,
    payload: { sent, live, sandbox, from, meetUrl: link, ids: sentIds },
  });
  return { activity, live };
}
