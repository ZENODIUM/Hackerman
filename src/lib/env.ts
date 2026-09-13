import "server-only";

import { getState } from "@/lib/store";

export function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function geminiModel(): string {
  return env("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
}

export function githubRepos(): string[] {
  const raw = env("GITHUB_REPOS") ?? "team-healthy,team-stalled,team-noisy";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function githubStallHours(): number {
  const n = Number(env("GITHUB_STALL_HOURS") ?? "5");
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export function connectionStatus() {
  const storedEvent = getState().eventId;
  return {
    gemini: Boolean(env("GEMINI_API_KEY")),
    github: Boolean(env("GITHUB_TOKEN") && env("GITHUB_OWNER")),
    discord: Boolean(env("DISCORD_BOT_TOKEN") && env("DISCORD_GUILD_ID")),
    eventbrite: Boolean(env("EVENTBRITE_TOKEN") && (env("EVENTBRITE_EVENT_ID") || env("EVENTBRITE_ORGANIZATION_ID") || storedEvent)),
    resend: Boolean(env("RESEND_API_KEY") && (env("RESEND_FROM") || env("RESEND_TEST_TO"))),
    langfuse: Boolean(env("LANGFUSE_PUBLIC_KEY") && env("LANGFUSE_SECRET_KEY")),
  };
}
