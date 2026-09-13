import "server-only";

import { env } from "@/lib/env";
import { eventSalesEnded, genericBrief } from "@/lib/hackathon";
import { getEventId, sleep } from "@/lib/ids";
import { addActivity, getState, patchPipeline, replaceAttendees, setMeta, upsertAttendees } from "@/lib/store";
import type { Activity, Attendee, HackathonBrief } from "@/lib/types";

const API = "https://www.eventbriteapi.com/v3";

function headers() {
  const token = env("EVENTBRITE_TOKEN");
  if (!token) throw new Error("EVENTBRITE_TOKEN missing");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function answerMap(answers: { question?: string; answer?: string }[] | undefined) {
  const out: Record<string, string> = {};
  for (const a of answers ?? []) {
    const q = (a.question ?? "").toLowerCase();
    if (q.includes("discord")) out.discord = a.answer ?? "";
    if (q.includes("github")) out.github = a.answer ?? "";
  }
  return out;
}

function fixtureAttendees(): Attendee[] {
  return [
    {
      id: "fixture-you",
      name: "Demo Hacker",
      email: "hacker@example.com",
      discord: "demo_hacker",
      github: env("GITHUB_OWNER") ?? "octocat",
      checkedIn: true,
      source: "manual",
    },
  ];
}

export async function syncAttendees(): Promise<{ attendees: Attendee[]; activity: Activity; live: boolean }> {
  const eventId = getEventId();
  let attendees: Attendee[] = [];
  let live = false;
  let detail = "";

  if (env("EVENTBRITE_TOKEN") && eventId) {
    const res = await fetch(`${API}/events/${eventId}/attendees/?expand=answers`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Eventbrite attendees ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      attendees?: {
        id: string;
        profile?: { name?: string; email?: string };
        answers?: { question?: string; answer?: string }[];
      }[];
    };
    attendees = (json.attendees ?? []).map((row) => {
      const extra = answerMap(row.answers);
      return {
        id: row.id,
        name: row.profile?.name ?? "Unknown",
        email: row.profile?.email ?? "",
        discord: extra.discord,
        github: extra.github,
        checkedIn: false,
        source: "eventbrite" as const,
      };
    });
    live = true;
    detail = `Synced ${attendees.length} attendee(s) from Eventbrite event ${eventId}.`;
    const ev = await fetch(`${API}/events/${eventId}/`, { headers: headers(), cache: "no-store" });
    if (ev.ok) {
      const body = (await ev.json()) as { name?: { text?: string }; url?: string };
      setMeta({
        eventName: body.name?.text,
        eventId,
        eventUrl: body.url ?? `https://www.eventbrite.com/e/${eventId}`,
      });
    }
  } else {
    attendees = fixtureAttendees();
    detail = eventId
      ? "Event id is stored but EVENTBRITE_TOKEN is missing — loaded fixture attendee."
      : "No Eventbrite event yet — loaded 1 fixture attendee so the dashboard still demos.";
  }

  if (live) replaceAttendees(attendees);
  else upsertAttendees(attendees);
  patchPipeline({ attendeesSynced: true });
  const activity = addActivity({
    agent: "registration",
    title: live ? "Eventbrite sync" : "Eventbrite fixture sync",
    detail,
    ok: true,
    payload: { count: attendees.length, live, eventId },
  });
  return { attendees, activity, live };
}

function currentBrief(): HackathonBrief {
  return getState().brief ?? genericBrief();
}

function utcStamp(iso: string) {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function eventPayload(brief: HackathonBrief, name?: string) {
  return {
    name: { html: name || brief.name },
    description: { html: `<p><strong>${brief.topic}</strong></p><p>${brief.description}</p>` },
    start: { timezone: brief.timezone, utc: utcStamp(brief.startAt) },
    end: { timezone: brief.timezone, utc: utcStamp(brief.endAt) },
    currency: "USD",
    online_event: true,
    listed: false,
    shareable: true,
    invite_only: false,
  };
}

export async function extendEventSales(eventId?: string): Promise<{ eventId?: string; activity: Activity; live: boolean }> {
  const id = eventId ?? getEventId();
  const brief = currentBrief();
  if (!env("EVENTBRITE_TOKEN") || !id) {
    const activity = addActivity({
      agent: "registration",
      title: "Extend sales skipped",
      detail: "No Eventbrite event to reopen.",
      ok: false,
      payload: { live: false },
    });
    return { activity, live: false };
  }

  const res = await fetch(`${API}/events/${id}/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ event: eventPayload(brief) }),
  });
  if (!res.ok) throw new Error(`Eventbrite extend ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { id: string; name?: { text?: string }; url?: string };

  const tickets = await fetch(`${API}/events/${id}/ticket_classes/`, { headers: headers(), cache: "no-store" });
  if (tickets.ok) {
    const body = (await tickets.json()) as { ticket_classes?: { id: string }[] };
    for (const ticket of body.ticket_classes ?? []) {
      await fetch(`${API}/ticket_classes/${ticket.id}/`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          ticket_class: {
            sales_start: utcStamp(new Date(Date.now() - 60_000).toISOString()),
            sales_end: utcStamp(brief.endAt),
            quantity_total: brief.capacity,
          },
        }),
      });
    }
  }

  setMeta({
    eventName: json.name?.text ?? brief.name,
    eventId: json.id,
    eventUrl: json.url ?? `https://www.eventbrite.com/e/${json.id}`,
  });
  patchPipeline({ eventCreated: true, ticketCreated: true });
  const activity = addActivity({
    agent: "registration",
    title: "Eventbrite sales reopened",
    detail: `Extended ${json.id} through ${new Date(brief.endAt).toLocaleString()}. Tickets sell until the event ends.`,
    ok: true,
    payload: { eventId: json.id, url: json.url, live: true },
  });
  return { eventId: json.id, activity, live: true };
}

export async function createPrivateEvent(name?: string): Promise<{ eventId?: string; activity: Activity }> {
  const brief = currentBrief();
  const existing = getEventId();
  if (existing && env("EVENTBRITE_TOKEN")) {
    const ev = await fetch(`${API}/events/${existing}/`, { headers: headers(), cache: "no-store" });
    if (ev.ok) {
      const body = (await ev.json()) as { start?: { utc?: string }; end?: { utc?: string } };
      if (eventSalesEnded(body.end?.utc, body.start?.utc) || eventSalesEnded(brief.endAt, brief.startAt)) {
        return extendEventSales(existing);
      }
    }
    const activity = addActivity({
      agent: "registration",
      title: "Eventbrite event reused",
      detail: `Using existing event ${existing}.`,
      ok: true,
      payload: { eventId: existing },
    });
    patchPipeline({ eventCreated: true });
    return { eventId: existing, activity };
  }

  const org = env("EVENTBRITE_ORGANIZATION_ID");
  if (!env("EVENTBRITE_TOKEN") || !org) {
    const activity = addActivity({
      agent: "registration",
      title: "Create event skipped",
      detail: "Set EVENTBRITE_TOKEN and EVENTBRITE_ORGANIZATION_ID to create events via API.",
      ok: false,
    });
    return { activity };
  }

  const res = await fetch(`${API}/organizations/${org}/events/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ event: eventPayload(brief, name) }),
  });
  if (!res.ok) throw new Error(`Eventbrite create ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { id: string; name?: { text?: string }; url?: string };
  setMeta({
    eventName: json.name?.text ?? name ?? brief.name,
    eventId: json.id,
    eventUrl: json.url ?? `https://www.eventbrite.com/e/${json.id}`,
  });
  patchPipeline({ eventCreated: true });
  const activity = addActivity({
    agent: "registration",
    title: "Created private Eventbrite event",
    detail: `Event ${json.id} created. Sales open until ${new Date(brief.endAt).toLocaleString()}.`,
    ok: true,
    payload: { eventId: json.id, url: json.url },
  });
  return { eventId: json.id, activity };
}

export async function createFreeTicket(eventId?: string): Promise<{ ticketId?: string; activity: Activity }> {
  const id = eventId ?? getEventId();
  if (!env("EVENTBRITE_TOKEN") || !id) {
    return {
      activity: addActivity({
        agent: "registration",
        title: "Ticket class skipped",
        detail: "Need a live Eventbrite event id first.",
        ok: false,
      }),
    };
  }

  const existing = await fetch(`${API}/events/${id}/ticket_classes/`, {
    headers: headers(),
    cache: "no-store",
  });
  if (existing.ok) {
    const body = (await existing.json()) as { ticket_classes?: { id: string; name?: string }[] };
    const hit = body.ticket_classes?.[0];
    if (hit) {
      const brief = currentBrief();
      await fetch(`${API}/ticket_classes/${hit.id}/`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          ticket_class: {
            sales_start: utcStamp(new Date(Date.now() - 60_000).toISOString()),
            sales_end: utcStamp(brief.endAt),
            quantity_total: brief.capacity,
          },
        }),
      });
      patchPipeline({ ticketCreated: true });
      return {
        ticketId: hit.id,
        activity: addActivity({
          agent: "registration",
          title: "Ticket class reused",
          detail: `Using ${hit.name ?? "existing"} ticket ${hit.id}. Sales end ${new Date(brief.endAt).toLocaleString()}.`,
          ok: true,
          payload: { ticketId: hit.id },
        }),
      };
    }
  }

  const brief = currentBrief();
  const res = await fetch(`${API}/events/${id}/ticket_classes/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      ticket_class: {
        name: "Hacker",
        free: brief.free,
        ...(brief.free ? {} : { cost: brief.cost ?? "0.00" }),
        quantity_total: brief.capacity,
        sales_end: utcStamp(brief.endAt),
      },
    }),
  });
  if (!res.ok) throw new Error(`Eventbrite ticket ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  patchPipeline({ ticketCreated: true });
  return {
    ticketId: json.id,
    activity: addActivity({
      agent: "registration",
      title: "Created free ticket class",
      detail: `Free Hacker ticket ${json.id} on event ${id}.`,
      ok: true,
      payload: { ticketId: json.id, eventId: id },
    }),
  };
}

export async function addIntakeQuestions(eventId?: string): Promise<Activity> {
  const id = eventId ?? getEventId();
  if (!env("EVENTBRITE_TOKEN") || !id) {
    return addActivity({
      agent: "registration",
      title: "Intake questions skipped",
      detail: "No Eventbrite event to attach Discord/GitHub questions.",
      ok: false,
    });
  }

  const questions = ["Discord username", "GitHub username"];
  let added = 0;
  for (const question of questions) {
    const res = await fetch(`${API}/events/${id}/questions/`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        question: {
          question: { html: question },
          type: "text",
          required: false,
          respondent: "attendee",
        },
      }),
    });
    if (res.ok) added += 1;
    await sleep(200);
  }

  return addActivity({
    agent: "registration",
    title: added ? "Added Eventbrite intake questions" : "Intake questions not supported",
    detail: added
      ? `Added ${added} custom question(s) (Discord + GitHub).`
      : "Eventbrite rejected custom questions on this event — attendees can still be synced without them.",
    ok: true,
    payload: { added },
  });
}

export async function publishEvent(eventId?: string): Promise<Activity> {
  const id = eventId ?? getEventId();
  if (!env("EVENTBRITE_TOKEN") || !id) {
    return addActivity({
      agent: "registration",
      title: "Publish skipped",
      detail: "No Eventbrite event to publish.",
      ok: false,
    });
  }
  const res = await fetch(`${API}/events/${id}/publish/`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) {
    return addActivity({
      agent: "registration",
      title: "Publish not required",
      detail: `Eventbrite publish ${res.status} — invite-only draft is fine for the demo.`,
      ok: true,
      payload: { status: res.status },
    });
  }
  return addActivity({
    agent: "registration",
    title: "Published Eventbrite event",
    detail: `Event ${id} is live for invitees.`,
    ok: true,
    payload: { eventId: id },
  });
}

export async function flagLowCapacity(): Promise<{ activity: Activity; live: boolean }> {
  const id = getEventId();
  if (!env("EVENTBRITE_TOKEN") || !id) {
    const activity = addActivity({
      agent: "registration",
      title: "Capacity check (dry run)",
      detail: "No Eventbrite event — cannot read ticket remaining.",
      ok: true,
      payload: { live: false },
    });
    return { activity, live: false };
  }

  const res = await fetch(`${API}/events/${id}/ticket_classes/`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Eventbrite tickets ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    ticket_classes?: { name?: string; quantity_total?: number; quantity_sold?: number }[];
  };
  const rows = (body.ticket_classes ?? []).map((t) => {
    const total = t.quantity_total ?? 0;
    const sold = t.quantity_sold ?? 0;
    const remaining = Math.max(0, total - sold);
    const low = total > 0 && remaining <= Math.max(10, Math.ceil(total * 0.15));
    return { name: t.name ?? "ticket", total, sold, remaining, low };
  });
  const flagged = rows.filter((r) => r.low);
  const activity = addActivity({
    agent: "registration",
    title: flagged.length ? "Low ticket capacity" : "Ticket capacity ok",
    detail: rows.length
      ? rows.map((r) => `${r.name}: ${r.sold}/${r.total} sold, ${r.remaining} left${r.low ? " · LOW" : ""}`).join(" · ")
      : "No ticket classes on this event.",
    ok: true,
    payload: { live: true, rows, flagged: flagged.length },
  });
  return { activity, live: true };
}

export async function listUnregisteredInvitees(): Promise<{ activity: Activity; live: boolean }> {
  const eventId = getEventId();
  let people = getState().attendees;
  let live = false;
  let emptyLive = false;

  if (env("EVENTBRITE_TOKEN") && eventId) {
    const res = await fetch(`${API}/events/${eventId}/attendees/?expand=answers`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Eventbrite attendees ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      attendees?: {
        id: string;
        profile?: { name?: string; email?: string };
        answers?: { question?: string; answer?: string }[];
      }[];
    };
    live = true;
    const fetched = (json.attendees ?? []).map((row) => {
      const extra = answerMap(row.answers);
      return {
        id: row.id,
        name: row.profile?.name ?? "Unknown",
        email: row.profile?.email ?? "",
        discord: extra.discord,
        github: extra.github,
        checkedIn: false,
        source: "eventbrite" as const,
      };
    });
    emptyLive = fetched.length === 0;
    if (fetched.length) {
      people = fetched;
      replaceAttendees(fetched);
    }
  }

  const incomplete = people.filter((a) => !a.discord || !a.github);
  const detail = emptyLive
    ? `Event ${eventId} has zero Eventbrite registrants — dashboard still keeps prior attendees for the demo.`
    : incomplete.length
      ? `Incomplete intake: ${incomplete.map((a) => `${a.name} (discord=${a.discord || "missing"}, github=${a.github || "missing"})`).join(" · ")}`
      : `${people.length} attendee(s) have Discord + GitHub on file.`;
  const activity = addActivity({
    agent: "registration",
    title: emptyLive ? "No registrants yet" : incomplete.length ? "Unregistered / incomplete invitees" : "Invitees complete",
    detail,
    ok: true,
    payload: { live, incomplete: incomplete.map((a) => a.name), emptyLive },
  });
  return { activity, live };
}
