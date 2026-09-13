import "server-only";

import { env } from "@/lib/env";
import { getState } from "@/lib/store";
import type { DiscordIds } from "@/lib/types";

export function getEventId(): string | undefined {
  return getState().eventId ?? env("EVENTBRITE_EVENT_ID");
}

export function discordId<K extends keyof DiscordIds>(key: K): DiscordIds[K] | undefined {
  const stored = getState().discord?.[key];
  const envMap: Partial<Record<keyof DiscordIds, string | undefined>> = {
    onboardingChannelId: env("DISCORD_ONBOARDING_CHANNEL_ID"),
    alertsChannelId: env("DISCORD_ALERTS_CHANNEL_ID"),
    announcementsChannelId: env("DISCORD_ANNOUNCEMENTS_CHANNEL_ID"),
    mentorsChannelId: env("DISCORD_MENTORS_CHANNEL_ID"),
    hackerRoleId: env("DISCORD_HACKER_ROLE_ID"),
    stalledRoleId: env("DISCORD_STALLED_ROLE_ID"),
    inviteUrl: env("DISCORD_INVITE_URL"),
  };
  return (envMap[key] as DiscordIds[K] | undefined) ?? stored;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
