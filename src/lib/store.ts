import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { genericBrief } from "@/lib/hackathon";
import { cleanPersonName } from "@/lib/names";
import type {
  Activity,
  AppState,
  Attendee,
  DiscordIds,
  HackathonBrief,
  HackathonSummary,
  InterviewRubric,
  JudgingRound,
  PipelineFlags,
  Team,
} from "./types";

const DATA_PATH = join(process.cwd(), "data", "store.json");

type DiskHackathon = {
  id: string;
  brief?: HackathonBrief;
  setupPending?: boolean;
  briefConfirmed?: boolean;
  attendees: Attendee[];
  teams: Team[];
  activities: Activity[];
  interviews: InterviewRubric[];
  judging: JudgingRound[];
  meetUrl?: string;
  eventName?: string;
  eventId?: string;
  eventUrl?: string;
  pipeline?: PipelineFlags;
  discord?: DiscordIds;
};

type DiskRoot = {
  currentHackathonId: string;
  records: DiskHackathon[];
};

function emptySlice(id: string, brief?: HackathonBrief): DiskHackathon {
  return {
    id,
    brief: brief ?? genericBrief(),
    setupPending: false,
    briefConfirmed: false,
    attendees: [],
    teams: [],
    activities: [],
    interviews: [],
    judging: [],
    pipeline: {},
    discord: {},
  };
}

function summarize(row: DiskHackathon): HackathonSummary {
  const brief = row.brief ?? genericBrief();
  return {
    id: row.id,
    name: brief.name || row.eventName || "Untitled hackathon",
    topic: brief.topic,
    startAt: brief.startAt,
    endAt: brief.endAt,
    eventId: row.eventId,
    eventUrl: row.eventUrl,
  };
}

function sanitizeAttendee(person: Attendee): Attendee {
  const name = cleanPersonName(person.name) || person.name;
  return name === person.name ? person : { ...person, name };
}

function sanitizeRoot(root: DiskRoot): boolean {
  let dirty = false;
  for (const row of root.records) {
    const attendees = row.attendees.map(sanitizeAttendee);
    if (attendees.some((person, i) => person !== row.attendees[i])) {
      row.attendees = attendees;
      dirty = true;
    }
  }
  return dirty;
}

function toPublic(root: DiskRoot): AppState {
  const current = root.records.find((r) => r.id === root.currentHackathonId) ?? root.records[0];
  return {
    currentHackathonId: current.id,
    hackathons: root.records.map(summarize),
    brief: current.brief,
    setupPending: current.setupPending,
    briefConfirmed: current.briefConfirmed,
    attendees: current.attendees,
    teams: current.teams,
    activities: current.activities,
    interviews: current.interviews,
    judging: current.judging,
    meetUrl: current.meetUrl,
    eventName: current.eventName,
    eventId: current.eventId,
    eventUrl: current.eventUrl,
    pipeline: current.pipeline ?? {},
    discord: current.discord ?? {},
  };
}

function fromLegacy(raw: Partial<AppState> & { records?: DiskHackathon[]; currentHackathonId?: string }): DiskRoot {
  if (Array.isArray(raw.records) && raw.records.length) {
    const id = raw.currentHackathonId && raw.records.some((r) => r.id === raw.currentHackathonId)
      ? raw.currentHackathonId
      : raw.records[0].id;
    return {
      currentHackathonId: id,
      records: raw.records.map((row) => ({
        ...emptySlice(row.id),
        ...row,
        attendees: row.attendees ?? [],
        teams: row.teams ?? [],
        activities: row.activities ?? [],
        interviews: row.interviews ?? [],
        judging: row.judging ?? [],
        pipeline: row.pipeline ?? {},
        discord: row.discord ?? {},
      })),
    };
  }
  const id = raw.currentHackathonId || crypto.randomUUID();
  return {
    currentHackathonId: id,
    records: [
      {
        ...emptySlice(id),
        brief: raw.brief ?? genericBrief(),
        setupPending: raw.setupPending,
        briefConfirmed: raw.briefConfirmed,
        attendees: raw.attendees ?? [],
        teams: raw.teams ?? [],
        activities: raw.activities ?? [],
        interviews: raw.interviews ?? [],
        judging: raw.judging ?? [],
        meetUrl: raw.meetUrl,
        eventName: raw.eventName,
        eventId: raw.eventId,
        eventUrl: raw.eventUrl,
        pipeline: raw.pipeline ?? {},
        discord: raw.discord ?? {},
      },
    ],
  };
}

let cache: DiskRoot | null = null;

function loadRoot(): DiskRoot {
  if (cache) return cache;
  try {
    cache = fromLegacy(JSON.parse(readFileSync(DATA_PATH, "utf8")) as Partial<AppState> & DiskRoot);
  } catch {
    const id = crypto.randomUUID();
    cache = { currentHackathonId: id, records: [emptySlice(id)] };
  }
  if (sanitizeRoot(cache)) saveRoot(cache);
  return cache;
}

function saveRoot(root: DiskRoot) {
  cache = root;
  mkdirSync(dirname(DATA_PATH), { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify(root, null, 2), "utf8");
}

function currentRecord(): DiskHackathon {
  const root = loadRoot();
  const hit = root.records.find((r) => r.id === root.currentHackathonId);
  if (hit) return hit;
  root.records[0] ??= emptySlice(root.currentHackathonId);
  root.currentHackathonId = root.records[0].id;
  return root.records[0];
}

function writeCurrent(patch: Partial<DiskHackathon>) {
  const root = loadRoot();
  const next = root.records.map((row) =>
    row.id === root.currentHackathonId ? { ...row, ...patch } : row,
  );
  saveRoot({ ...root, records: next });
}

export function getState(): AppState {
  return toPublic(loadRoot());
}

export function resetState() {
  const id = crypto.randomUUID();
  saveRoot({ currentHackathonId: id, records: [emptySlice(id)] });
}

export function createHackathon(brief?: HackathonBrief): AppState {
  const root = loadRoot();
  const id = crypto.randomUUID();
  const row = emptySlice(id, brief ?? genericBrief());
    row.setupPending = !brief;
    row.briefConfirmed = Boolean(brief);
  saveRoot({ currentHackathonId: id, records: [...root.records, row] });
  return getState();
}

export function selectHackathon(id: string): AppState {
  const root = loadRoot();
  if (!root.records.some((r) => r.id === id)) return getState();
  saveRoot({ ...root, currentHackathonId: id });
  return getState();
}

export function updateBrief(patch: Partial<HackathonBrief>): HackathonBrief {
  const row = currentRecord();
  const next = { ...(row.brief ?? genericBrief()), ...patch };
  writeCurrent({ brief: next, eventName: next.name, briefConfirmed: true, setupPending: false });
  return next;
}

export function setSetupPending(pending: boolean) {
  writeCurrent({ setupPending: pending });
}

export function upsertAttendees(incoming: Attendee[]): Attendee[] {
  const row = currentRecord();
  const byId = new Map(row.attendees.map((a) => [a.id, a]));
  for (const item of incoming) byId.set(item.id, sanitizeAttendee({ ...byId.get(item.id), ...item }));
  const attendees = [...byId.values()];
  writeCurrent({ attendees });
  return attendees;
}

export function replaceAttendees(incoming: Attendee[]): Attendee[] {
  const attendees = incoming.map(sanitizeAttendee);
  writeCurrent({ attendees });
  return attendees;
}

export function upsertTeams(incoming: Team[]): Team[] {
  const row = currentRecord();
  const byName = new Map(row.teams.map((t) => [t.name, t]));
  for (const item of incoming) byName.set(item.name, { ...byName.get(item.name), ...item });
  const teams = [...byName.values()];
  writeCurrent({ teams });
  return teams;
}

export function replaceTeams(incoming: Team[]): Team[] {
  writeCurrent({ teams: incoming });
  return incoming;
}

export function addActivity(activity: Omit<Activity, "id" | "ts"> & { ts?: string }): Activity {
  const row = currentRecord();
  const item: Activity = {
    id: crypto.randomUUID(),
    ts: activity.ts ?? new Date().toISOString(),
    agent: activity.agent,
    title: activity.title,
    detail: activity.detail,
    ok: activity.ok,
    payload: activity.payload,
  };
  writeCurrent({ activities: [...row.activities, item].slice(-200) });
  return item;
}

export function addInterview(rubric: InterviewRubric): InterviewRubric {
  const row = currentRecord();
  writeCurrent({ interviews: [...row.interviews, rubric].slice(-50) });
  return rubric;
}

export function addJudging(round: JudgingRound): JudgingRound {
  const row = currentRecord();
  writeCurrent({
    judging: [...row.judging.filter((item) => item.teamId !== round.teamId), round].slice(-40),
  });
  return round;
}

export function setMeta(patch: Partial<AppState>) {
  const row = currentRecord();
  const next: DiskHackathon = { ...row };
  if (patch.discord) next.discord = { ...row.discord, ...patch.discord };
  if (patch.pipeline) next.pipeline = { ...row.pipeline, ...patch.pipeline };
  if (patch.brief) next.brief = { ...(row.brief ?? genericBrief()), ...patch.brief };
  if (typeof patch.setupPending === "boolean") next.setupPending = patch.setupPending;
  const skip = new Set([
    "attendees",
    "teams",
    "activities",
    "interviews",
    "judging",
    "discord",
    "pipeline",
    "brief",
    "hackathons",
    "currentHackathonId",
    "setupPending",
  ]);
  for (const [key, value] of Object.entries(patch)) {
    if (skip.has(key) || value === undefined) continue;
    (next as Record<string, unknown>)[key] = value;
  }
  writeCurrent(next);
  return getState();
}

export function patchPipeline(patch: Partial<PipelineFlags>) {
  const row = currentRecord();
  const pipeline = { ...row.pipeline, ...patch };
  writeCurrent({ pipeline });
  return pipeline;
}

export function patchDiscord(patch: Partial<DiscordIds>) {
  const row = currentRecord();
  const discord = { ...row.discord, ...patch };
  writeCurrent({ discord });
  return discord;
}
