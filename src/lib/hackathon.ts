import type { HackathonBrief } from "@/lib/types";

export const SETUP_PROMPT = `Before I stand up Eventbrite / Discord / GitHub, I need a brief. Reply with answers, or say GENERIC / DEFAULTS and I will fill the rest.

1. Hackathon name
2. Topic / theme
3. Short description
4. Ticket price (free, or a dollar amount)
5. Start date and time
6. End date and time`;

export function genericBrief(): HackathonBrief {
  const start = new Date(Date.now() + 2 * 3600_000);
  const end = new Date(start.getTime() + 48 * 3600_000);
  return {
    name: "Hackerman Ghost Event",
    topic: "Multi-app AI agents",
    description:
      "A same-day hackathon to stand up a supervisor plus Eventbrite, Discord, and GitHub workers. Online, tickets stay on sale through the event end.",
    free: true,
    priceLabel: "free",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timezone: "America/New_York",
    capacity: 100,
  };
}

export function briefComplete(brief?: HackathonBrief, confirmed?: boolean): boolean {
  if (!confirmed || !brief) return false;
  return Boolean(brief.name?.trim() && brief.startAt && brief.endAt);
}

export function wantsDefaults(text: string): boolean {
  return /^(generic|defaults?|use defaults|skip|n\/a|just (stand ?up|go)|fill it|whatever)\b/i.test(text.trim());
}

export function looksLikeBrief(text: string): boolean {
  if (wantsDefaults(text)) return true;
  if (/(name|topic|theme|description|price|start|end)\s*[:=-]/i.test(text)) return true;
  return text.split(/\r?\n/).filter((l) => l.trim()).length >= 3;
}

function parsePrice(raw: string): Pick<HackathonBrief, "free" | "cost" | "priceLabel"> {
  const t = raw.trim().toLowerCase();
  if (!t || t === "free" || t === "0" || t === "$0") return { free: true, priceLabel: "free" };
  const num = t.replace(/[^0-9.]/g, "");
  if (!num) return { free: true, priceLabel: "free" };
  const cost = Number(num).toFixed(2);
  return { free: false, cost, priceLabel: `$${cost}` };
}

function parseWhen(raw: string, fallback: string): string {
  const t = raw.trim();
  if (!t) return fallback;
  const ms = Date.parse(t);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  return fallback;
}

export function parseBriefFromText(text: string, base = genericBrief()): HackathonBrief {
  const next = { ...base };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const labeled: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^(?:[\d.]+[)\].:-]\s*)?(name|title|topic|theme|description|desc|price|cost|ticket|start|end|capacity)\s*[:=-]\s*(.+)$/i);
    if (m) labeled[m[1].toLowerCase()] = m[2].trim();
  }

  const name = labeled.name ?? labeled.title;
  const topic = labeled.topic ?? labeled.theme;
  const description = labeled.description ?? labeled.desc;
  const price = labeled.price ?? labeled.cost ?? labeled.ticket;
  const start = labeled.start;
  const end = labeled.end;
  const capacity = labeled.capacity;

  if (name) next.name = name;
  if (topic) next.topic = topic;
  if (description) next.description = description;
  if (price) Object.assign(next, parsePrice(price));
  if (start) next.startAt = parseWhen(start, next.startAt);
  if (end) next.endAt = parseWhen(end, next.endAt);
  if (capacity && Number(capacity) > 0) next.capacity = Number(capacity);

  if (!name && !topic && lines.length === 1 && text.length < 80 && !wantsDefaults(text)) {
    next.name = text.trim();
  }
  if (new Date(next.endAt) <= new Date(next.startAt)) {
    next.endAt = new Date(new Date(next.startAt).getTime() + 48 * 3600_000).toISOString();
  }
  return next;
}

export function formatBrief(brief: HackathonBrief): string {
  const start = new Date(brief.startAt).toLocaleString();
  const end = new Date(brief.endAt).toLocaleString();
  return [
    `Name: ${brief.name}`,
    `Topic: ${brief.topic}`,
    `Description: ${brief.description}`,
    `Price: ${brief.priceLabel}`,
    `Start: ${start} (${brief.timezone})`,
    `End: ${end}`,
    `Capacity: ${brief.capacity}`,
  ].join("\n");
}

export function eventSalesEnded(endAt?: string, startAt?: string): boolean {
  const end = endAt ? Date.parse(endAt) : NaN;
  const start = startAt ? Date.parse(startAt) : NaN;
  if (Number.isFinite(end) && end <= Date.now()) return true;
  if (Number.isFinite(start) && start <= Date.now() - 5 * 60_000) return true;
  return false;
}
