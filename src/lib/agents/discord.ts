import "server-only";

import { checkHealth } from "@/lib/agents/github";
import { env } from "@/lib/env";
import { discordId, sleep } from "@/lib/ids";
import { buildLeaderboard } from "@/lib/leaderboard";
import { addActivity, getState, patchDiscord, patchPipeline } from "@/lib/store";
import type { Activity, Attendee, Team } from "@/lib/types";

const API = "https://discord.com/api/v10";
const VIEW_SEND_HISTORY = "68608";

function headers() {
  const token = env("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("DISCORD_BOT_TOKEN missing");
  return { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
}

async function discord<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: T }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  let json = {} as T;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = { message: text } as T;
    }
  }
  return { ok: res.ok, status: res.status, json };
}

export async function postChannel(channelId: string | undefined, content: string) {
  if (!channelId) throw new Error("Discord channel id missing");
  const res = await discord<{ id?: string }>(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Discord post ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json;
}

type MemberHit = {
  nick?: string | null;
  user?: { id: string; username: string; global_name?: string | null };
};

function memberMatches(row: MemberHit, query: string) {
  const q = query.toLowerCase();
  return (
    row.user?.username.toLowerCase() === q ||
    row.user?.global_name?.toLowerCase() === q ||
    row.nick?.toLowerCase() === q
  );
}

async function findMemberId(query: string): Promise<string | undefined> {
  const guild = env("DISCORD_GUILD_ID");
  const clean = query.replace(/^@/, "").trim();
  if (!guild || !clean) return undefined;
  if (/^\d{16,20}$/.test(clean)) return clean;

  const res = await discord<MemberHit[]>(
    `/guilds/${guild}/members/search?query=${encodeURIComponent(clean)}&limit=10`,
  );
  if (res.ok && Array.isArray(res.json)) {
    const exact = res.json.find((row) => memberMatches(row, clean));
    if (exact?.user?.id) return exact.user.id;
    if (res.json.length === 1 && res.json[0]?.user?.id) return res.json[0].user.id;
  }

  const listed = await discord<MemberHit[]>(`/guilds/${guild}/members?limit=100`);
  if (listed.ok && Array.isArray(listed.json)) {
    const exact = listed.json.find((row) => memberMatches(row, clean));
    if (exact?.user?.id) return exact.user.id;
  }
  return undefined;
}

async function addRole(memberId: string, roleId: string | undefined) {
  const guild = env("DISCORD_GUILD_ID");
  if (!guild || !roleId) return;
  await discord(`/guilds/${guild}/members/${memberId}/roles/${roleId}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Length": "0" },
  });
}

type ChannelRow = { id: string; name: string; type: number; parent_id?: string | null };
type RoleRow = { id: string; name: string };

async function ensureRole(name: string, existing: RoleRow[]): Promise<string> {
  const hit = existing.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const guild = env("DISCORD_GUILD_ID")!;
  const res = await discord<RoleRow>(`/guilds/${guild}/roles`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Discord role ${name} ${res.status}: ${JSON.stringify(res.json)}`);
  existing.push(res.json);
  await sleep(350);
  return res.json.id;
}

async function ensureChannel(
  name: string,
  existing: ChannelRow[],
  parentId?: string,
  overwrites?: { id: string; type: number; allow?: string; deny?: string }[],
): Promise<string> {
  const hit = existing.find((c) => c.name === name && c.type === 0);
  if (hit) return hit.id;
  const guild = env("DISCORD_GUILD_ID")!;
  const res = await discord<ChannelRow>(`/guilds/${guild}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name,
      type: 0,
      parent_id: parentId,
      permission_overwrites: overwrites,
    }),
  });
  if (!res.ok) throw new Error(`Discord channel #${name} ${res.status}: ${JSON.stringify(res.json)}`);
  existing.push(res.json);
  await sleep(350);
  return res.json.id;
}

export async function ensureGuildSetup(): Promise<{ activity: Activity; live: boolean }> {
  const guild = env("DISCORD_GUILD_ID");
  const live = Boolean(env("DISCORD_BOT_TOKEN") && guild);
  if (!live) {
    const activity = addActivity({
      agent: "community",
      title: "Discord guild setup (dry run)",
      detail: "No bot token/guild — would create agent channels, onboarding, alerts, and Hacker/Stalled roles.",
      ok: true,
      payload: { live: false },
    });
    return { activity, live: false };
  }

  const channelsRes = await discord<ChannelRow[]>(`/guilds/${guild}/channels`);
  const rolesRes = await discord<RoleRow[]>(`/guilds/${guild}/roles`);
  const meRes = await discord<{ id: string; username?: string }>("/users/@me");
  if (!channelsRes.ok || !rolesRes.ok || !meRes.ok) {
    throw new Error(`Discord setup read failed channels=${channelsRes.status} roles=${rolesRes.status}`);
  }

  const channels = channelsRes.json;
  const roles = rolesRes.json;
  const botId = meRes.json.id;

  let category = channels.find((c) => c.type === 4 && c.name.toLowerCase() === "hackerman");
  if (!category) {
    const created = await discord<ChannelRow>(`/guilds/${guild}/channels`, {
      method: "POST",
      body: JSON.stringify({ name: "hackerman", type: 4 }),
    });
    if (!created.ok) throw new Error(`Discord category ${created.status}: ${JSON.stringify(created.json)}`);
    category = created.json;
    channels.push(category);
    await sleep(350);
  }

  const hackerRoleId = await ensureRole("Hacker", roles);
  const stalledRoleId = await ensureRole("Stalled", roles);

  const ids = {
    categoryId: category.id,
    supervisorChannelId: await ensureChannel("supervisor", channels, category.id),
    registrationChannelId: await ensureChannel("registration-agent", channels, category.id),
    progressChannelId: await ensureChannel("progress-agent", channels, category.id),
    communityChannelId: await ensureChannel("community-agent", channels, category.id),
    interviewChannelId: await ensureChannel("interview-agent", channels, category.id),
    onboardingChannelId: await ensureChannel("onboarding", channels, category.id),
    alertsChannelId: await ensureChannel("alerts", channels, category.id),
    announcementsChannelId: await ensureChannel("announcements", channels, category.id),
    mentorsChannelId: await ensureChannel("mentors", channels, category.id),
    hackerRoleId,
    stalledRoleId,
  };

  const intros: [string, string][] = [
    [ids.supervisorChannelId, "**Supervisor online.** Routes Eventbrite / GitHub / Discord / Interview."],
    [ids.registrationChannelId, "**Registration agent online.** Syncs Eventbrite attendees and welcome mail."],
    [ids.progressChannelId, "**Progress agent online.** Watches GitHub commits and opens stall issues."],
    [ids.communityChannelId, "**Community agent online.** Onboards hackers and nudges stalled teams."],
    [ids.interviewChannelId, "**Interview agent online.** 15s camera + voice authenticity screen."],
    [ids.onboardingChannelId, "**Onboarding.** New hackers land here. Role: Hacker."],
    [ids.alertsChannelId, "**Alerts.** Stall handoffs from the Progress agent."],
  ];
  for (const [channelId, content] of intros) {
    try {
      await postChannel(channelId, content);
    } catch {
      /* channel may already have messages; not fatal */
    }
    await sleep(250);
  }

  let inviteUrl = discordId("inviteUrl");
  if (!inviteUrl) {
    const invite = await discord<{ code?: string }>(`/channels/${ids.onboardingChannelId}/invites`, {
      method: "POST",
      body: JSON.stringify({ max_age: 0, max_uses: 0 }),
    });
    if (invite.ok && invite.json.code) inviteUrl = `https://discord.gg/${invite.json.code}`;
  }

  patchDiscord({ ...ids, inviteUrl });
  patchPipeline({ discordSetup: true });
  await registerStatusCommand();

  const activity = addActivity({
    agent: "community",
    title: "Discord guild setup",
    detail: `Created/reused Hackerman category, 5 agent channels, onboarding/alerts/announcements/mentors, Hacker + Stalled roles.${inviteUrl ? ` Invite: ${inviteUrl}` : ""} Bot ${meRes.json.username ?? botId}.`,
    ok: true,
    payload: { ...ids, inviteUrl, live: true },
  });
  return { activity, live: true };
}

export async function ensureTeamChannels(teamNames?: string[]): Promise<{ activity: Activity; live: boolean }> {
  const names = teamNames ?? getState().teams.map((t) => t.name);
  const fallback = names.length ? names : ["team-healthy", "team-stalled", "team-noisy"];
  const guild = env("DISCORD_GUILD_ID");
  const live = Boolean(env("DISCORD_BOT_TOKEN") && guild);
  if (!live) {
    const activity = addActivity({
      agent: "community",
      title: "Team channels (dry run)",
      detail: `Would create private rooms: ${fallback.join(", ")}`,
      ok: true,
    });
    return { activity, live: false };
  }

  const channelsRes = await discord<ChannelRow[]>(`/guilds/${guild}/channels`);
  const rolesRes = await discord<RoleRow[]>(`/guilds/${guild}/roles`);
  const meRes = await discord<{ id: string }>("/users/@me");
  if (!channelsRes.ok || !rolesRes.ok || !meRes.ok) {
    throw new Error("Discord team-channel read failed");
  }
  const channels = channelsRes.json;
  const roles = rolesRes.json;
  const parentId = getState().discord?.categoryId ?? channels.find((c) => c.type === 4 && c.name === "hackerman")?.id;
  const created: { name: string; id: string; roleId?: string }[] = [...(getState().discord?.teamChannels ?? [])];

  for (const raw of fallback) {
    const slug = raw.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    if (created.some((c) => c.name === slug)) continue;
    const roleId = await ensureRole(slug, roles);
    const channelId = await ensureChannel(slug, channels, parentId, [
      { id: guild!, type: 0, deny: "1024" },
      { id: roleId, type: 0, allow: VIEW_SEND_HISTORY },
      { id: meRes.json.id, type: 1, allow: VIEW_SEND_HISTORY },
    ]);
    created.push({ name: slug, id: channelId, roleId });
    try {
      await postChannel(channelId, `**Team room for ${raw}.** Progress + Community agents post here.`);
    } catch {
      /* ignore */
    }
  }

  patchDiscord({ teamChannels: created });
  patchPipeline({ teamChannelsCreated: true });
  const activity = addActivity({
    agent: "community",
    title: "Team Discord channels",
    detail: `Private rooms: ${created.map((c) => `#${c.name}`).join(", ")}`,
    ok: true,
    payload: { channels: created, live: true },
  });
  return { activity, live: true };
}

export async function onboardAttendees(attendees?: Attendee[]): Promise<{ activity: Activity; live: boolean }> {
  const people = attendees ?? getState().attendees;
  const channel = discordId("onboardingChannelId");
  const live = Boolean(env("DISCORD_BOT_TOKEN") && channel);
  const invite = discordId("inviteUrl") ?? "";
  const lines = people.length
    ? people
        .map((p) => `• **${p.name}** ${p.discord ? `(@${p.discord})` : ""} — GitHub \`${p.github ?? "?"}\``)
        .join("\n")
    : "• No attendees in store yet. Run Eventbrite sync first.";
  const content = [
    "**Registration agent → Community agent**",
    `Onboarding ${people.length} hacker(s). Role: Hacker.`,
    lines,
    invite ? `Invite: ${invite}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const assigned: string[] = [];
  const missed: string[] = [];
  if (live) {
    await postChannel(channel, content);
    const role = discordId("hackerRoleId");
    for (const p of people) {
      if (!p.discord) {
        missed.push(`${p.name} (no discord username)`);
        continue;
      }
      const id = await findMemberId(p.discord);
      if (id) {
        await addRole(id, role);
        assigned.push(p.discord);
      } else {
        missed.push(p.discord);
      }
    }
    if (missed.length) {
      addActivity({
        agent: "community",
        title: "Discord lookup missed",
        detail: `Posted to channel, but could not resolve member IDs for: ${missed.join(", ")}. Roles were not assigned for those names.`,
        ok: false,
        payload: { missed, assigned, live: true },
      });
    }
    const agentChan = discordId("registrationChannelId") ?? discordId("communityChannelId");
    if (agentChan && agentChan !== channel) {
      try {
        await postChannel(agentChan, content);
      } catch {
        /* ignore */
      }
    }
  }

  patchPipeline({ discordOnboarded: true });
  const activity = addActivity({
    agent: "community",
    title: live ? "Discord onboard posted" : "Discord onboard (dry run)",
    detail: live
      ? `Posted welcome for ${people.length} attendee(s) in #onboarding. Roles assigned: ${assigned.length}. Lookups missed: ${missed.length}.`
      : "No Discord bot token/channel — logged the message locally. Run guild setup first.",
    ok: true,
    payload: { count: people.length, live, assigned, missed },
  });
  return { activity, live };
}

export async function nudgeStalled(teams?: Team[]): Promise<{ activity: Activity; live: boolean }> {
  const stalled = (teams ?? getState().teams).filter((t) => t.health === "stalled");
  const channel = discordId("alertsChannelId");
  const live = Boolean(env("DISCORD_BOT_TOKEN") && channel);
  const content = stalled.length
    ? [
        "**Progress agent → Community agent**",
        "Stall handoff: these teams have gone quiet. Mentors, ping them.",
        ...stalled.map((t) => `• **${t.name}** (\`${t.repo}\`) — last commit ${t.lastCommit ?? "never"}`),
      ].join("\n")
    : "**Progress agent → Community agent**\nNo stalled teams right now.";

  if (live) {
    await postChannel(channel, content);
    const role = discordId("stalledRoleId");
    for (const t of stalled) {
      const attendee = getState().attendees.find((a) => a.github && t.repo.includes(a.github));
      if (!attendee?.discord) continue;
      const id = await findMemberId(attendee.discord.replace(/^@/, ""));
      if (id) await addRole(id, role);
    }
    const progress = discordId("progressChannelId");
    if (progress) {
      try {
        await postChannel(progress, content);
      } catch {
        /* ignore */
      }
    }
  }

  const activity = addActivity({
    agent: "community",
    title: live ? "Stall nudge posted" : "Stall nudge (dry run)",
    detail: `${stalled.length} stalled team(s). ${live ? "Posted to #alerts." : "Discord not connected."}`,
    ok: true,
    payload: { stalled: stalled.map((t) => t.repo), live },
  });
  return { activity, live };
}

/** One-shot Progress → Community handoff. Scan GitHub once, then nudge. Never loop. */
export async function handoffFromGithub(): Promise<{ activity: Activity; live: boolean }> {
  const health = await checkHealth();
  const nudge = await nudgeStalled(health.teams);
  const activity = addActivity({
    agent: "community",
    title: "Progress → Community handoff",
    detail: `${health.activity.detail}. Then ${nudge.activity.detail}`,
    ok: true,
    payload: { live: Boolean(health.live && nudge.live), stalled: health.stalled },
  });
  return { activity, live: Boolean(health.live && nudge.live) };
}

export async function postTimeline(message: string): Promise<Activity> {
  const channel = discordId("announcementsChannelId");
  const live = Boolean(env("DISCORD_BOT_TOKEN") && channel);
  const content = `**Timeline update**\n${message}`;
  if (live) await postChannel(channel, content);
  return addActivity({
    agent: "community",
    title: live ? "Timeline posted" : "Timeline (dry run)",
    detail: message,
    ok: true,
    payload: { live },
  });
}

export async function answerSupport(question: string): Promise<Activity> {
  const faq: Record<string, string> = {
    wifi: "Wi-Fi SSID: Hackerman / password is on the #announcements pin.",
    submit: "Submit the repo URL + 2-minute demo + reliability brief before 4:00pm PT.",
    team: "Solo? Ask in #onboarding — the matchmaking agent will pair you.",
    stall: "Stuck? Post /stuck or wait for the Progress agent to ping #alerts.",
  };
  const key = Object.keys(faq).find((k) => question.toLowerCase().includes(k));
  const answer = key ? faq[key] : "Escalating to mentors — I don't have a canned answer for that.";
  const live = Boolean(env("DISCORD_BOT_TOKEN") && discordId("mentorsChannelId"));
  if (live && !key) {
    await postChannel(discordId("mentorsChannelId"), `**Support ticket**\n${question}\nNeed a human.`);
  }
  return addActivity({
    agent: "community",
    title: key ? "Support FAQ" : "Support escalated",
    detail: answer,
    ok: true,
    payload: { question, escalated: !key, live },
  });
}

export function formatStatusMessage() {
  const state = getState();
  const teams = state.teams.length
    ? state.teams
        .map((t) => {
          const prizes = t.prizes?.length ? ` · ${t.prizes.join(", ")}` : "";
          return `• **${t.name}** ${t.health} (${t.commitCount} commits)${prizes}`;
        })
        .join("\n")
    : "• No teams scanned yet.";
  return `**Hackerman /status**\n${teams}\nAttendees: ${state.attendees.length} · Interviews: ${state.interviews.length}`;
}

export async function registerStatusCommand(): Promise<Activity> {
  const guild = env("DISCORD_GUILD_ID");
  if (!env("DISCORD_BOT_TOKEN") || !guild) {
    return addActivity({
      agent: "community",
      title: "Slash /status skipped",
      detail: "No Discord bot/guild — cannot register /status.",
      ok: false,
    });
  }
  const app = await discord<{ id: string }>("/oauth2/applications/@me");
  if (!app.ok || !app.json.id) {
    return addActivity({
      agent: "community",
      title: "Slash /status failed",
      detail: "Could not read Discord application id.",
      ok: false,
    });
  }
  const res = await discord(`/applications/${app.json.id}/guilds/${guild}/commands`, {
    method: "PUT",
    body: JSON.stringify([
      {
        name: "status",
        description: "Hackerman: team health, stalls, and sponsor matches",
        type: 1,
      },
    ]),
  });
  return addActivity({
    agent: "community",
    title: res.ok ? "Registered /status" : "Slash /status failed",
    detail: res.ok
      ? "Guild command /status is registered. Set this app's Interactions Endpoint URL to https://YOUR-PUBLIC-HOST/api/discord/interactions and add DISCORD_PUBLIC_KEY."
      : `Discord command register ${res.status}`,
    ok: res.ok,
    payload: { live: res.ok },
  });
}

export async function postLeaderboard(): Promise<Activity> {
  await checkHealth();
  const state = getState();
  const board = buildLeaderboard(state);
  const channel = discordId("announcementsChannelId");
  const live = Boolean(env("DISCORD_BOT_TOKEN") && channel);
  const lines = board.length
    ? board.map((row, i) => {
        const prizes = row.prizes.length ? row.prizes.join(", ") : "no sponsor match";
        const interview = row.scoredBy ? `interview ${row.scoredBy}` : "no interview";
        const judged = row.judgeScore != null ? ` · judge ${row.judgeScore}` : "";
        return `${i + 1}. **${row.name}** ${row.health} · board ${row.score}${judged} · ${interview}\n   ${prizes}`;
      })
    : ["No teams scanned yet — run a GitHub health check first."];
  const content = ["**Hackerman leaderboard**", "GitHub health + interview + sponsor match + judge.", ...lines].join("\n");
  if (live) await postChannel(channel, content);
  return addActivity({
    agent: "community",
    title: live ? "Leaderboard posted" : "Leaderboard (dry run)",
    detail: board.map((r) => `${r.name}:${r.score}`).join(" / ") || "empty board",
    ok: true,
    payload: { live, rows: board },
  });
}

export async function matchmake(): Promise<Activity> {
  const solos = getState().attendees.filter((a) => !a.teamId);
  const channel = discordId("onboardingChannelId");
  const live = Boolean(env("DISCORD_BOT_TOKEN") && channel);
  const content = solos.length
    ? `**Looking for teammates**\n${solos.map((s) => `• ${s.name} (${s.github ?? "no github"})`).join("\n")}`
    : "Everyone is already on a team.";
  if (live) await postChannel(channel, content);
  return addActivity({
    agent: "community",
    title: "Matchmaking",
    detail: `${solos.length} solo hacker(s).`,
    ok: true,
    payload: { solos: solos.map((s) => s.name), live },
  });
}
