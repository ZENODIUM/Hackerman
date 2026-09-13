import "server-only";

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "@/lib/env";
import type { AgentTrace } from "@/lib/types";

export function langfuseConfigured() {
  return Boolean(env("LANGFUSE_PUBLIC_KEY") && env("LANGFUSE_SECRET_KEY"));
}

/** Free-tier cap: only supervisor routing traces go to Langfuse. Workers stay local. */
export function shouldExportToLangfuse(node: string) {
  return node === "supervisor";
}

function baseUrl() {
  return (env("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com").replace(/\/$/, "");
}

function authHeader() {
  const pk = env("LANGFUSE_PUBLIC_KEY");
  const sk = env("LANGFUSE_SECRET_KEY");
  if (!pk || !sk) return undefined;
  return `Basic ${Buffer.from(`${pk}:${sk}`).toString("base64")}`;
}

function hexId(bytes: number) {
  return crypto.randomUUID().replace(/-/g, "").slice(0, bytes * 2);
}

function unixNano(iso: string) {
  const ms = new Date(iso).getTime();
  return `${Number.isFinite(ms) ? ms : Date.now()}000000`;
}

function rememberStatus(row: Record<string, unknown>) {
  try {
    writeFileSync(join(process.cwd(), "data", "langfuse-status.json"), JSON.stringify(row, null, 2));
  } catch {
    /* ignore */
  }
}

export async function ingestLangfuse(trace: AgentTrace) {
  const auth = authHeader();
  if (!auth) {
    rememberStatus({ ok: false, skipped: true, ts: new Date().toISOString() });
    return { ok: false, skipped: true as const };
  }
  const traceId = hexId(16);
  const spanId = hexId(8);
  try {
    const res = await fetch(`${baseUrl()}/api/public/otel/v1/traces`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "hackerman" } },
                { key: "service.version", value: { stringValue: "0.1.0" } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "hackerman.supervisor" },
                spans: [
                  {
                    traceId,
                    spanId,
                    name: trace.name,
                    kind: 1,
                    startTimeUnixNano: unixNano(trace.ts),
                    endTimeUnixNano: unixNano(trace.ts),
                    attributes: [
                      {
                        key: "langfuse.observation.input",
                        value: { stringValue: String(trace.input).slice(0, 1500) },
                      },
                      {
                        key: "langfuse.observation.output",
                        value: { stringValue: String(trace.output).slice(0, 1500) },
                      },
                      {
                        key: "langfuse.observation.type",
                        value: { stringValue: "span" },
                      },
                    ],
                    status: { code: trace.ok ? 1 : 2 },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    const snippet = (await res.text()).slice(0, 240);
    rememberStatus({
      ok: res.ok,
      status: res.status,
      skipped: false,
      via: "otel",
      ts: new Date().toISOString(),
      snippet,
    });
    return { ok: res.ok, status: res.status, skipped: false as const };
  } catch (err) {
    rememberStatus({
      ok: false,
      skipped: false,
      ts: new Date().toISOString(),
      error: err instanceof Error ? err.message : "langfuse failed",
    });
    return { ok: false, skipped: false as const, error: err instanceof Error ? err.message : "langfuse failed" };
  }
}

export async function fetchLangfuseTraces(limit = 8): Promise<AgentTrace[]> {
  const auth = authHeader();
  if (!auth) return [];
  try {
    const res = await fetch(`${baseUrl()}/api/public/traces?limit=${limit}`, {
      headers: { Authorization: auth },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { id?: string; timestamp?: string; name?: string; input?: unknown; output?: unknown }[];
    };
    return (json.data ?? []).map((row) => ({
      id: row.id ?? crypto.randomUUID(),
      ts: row.timestamp ?? new Date().toISOString(),
      name: row.name ?? "trace",
      input: typeof row.input === "string" ? row.input : JSON.stringify(row.input ?? ""),
      output: typeof row.output === "string" ? row.output : JSON.stringify(row.output ?? ""),
      ok: true,
      metadata: { source: "langfuse" },
    }));
  } catch {
    return [];
  }
}
