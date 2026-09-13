import "server-only";

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ingestLangfuse, shouldExportToLangfuse } from "./langfuse";
import { redact, redactString } from "./redact";
import type { AgentTrace } from "./types";

const SESSION_JSONL = join(process.cwd(), "agent-logs", "session.jsonl");
const SESSION_MD = join(process.cwd(), "agent-logs", "session.md");
const RUNS_JSONL = join(process.cwd(), "data", "agent-runs.jsonl");
const TRACES_JSONL = join(process.cwd(), "data", "traces.jsonl");

export type JournalEntry = {
  ts: string;
  step: string;
  user_prompt: string;
  agent_summary: string;
  files?: string[];
};

function appendJsonl(path: string, row: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(redact(row))}\n`, "utf8");
}

export function logBuildStep(entry: Omit<JournalEntry, "ts"> & { ts?: string }) {
  const row: JournalEntry = {
    ts: entry.ts ?? new Date().toISOString(),
    step: entry.step,
    user_prompt: redactString(entry.user_prompt),
    agent_summary: redactString(entry.agent_summary),
    files: entry.files,
  };
  appendJsonl(SESSION_JSONL, row);
  mkdirSync(dirname(SESSION_MD), { recursive: true });
  const md = `\n## ${row.ts} · ${row.step}\n\n**Prompt:** ${row.user_prompt}\n\n**Summary:** ${row.agent_summary}\n${
    row.files?.length ? `\n**Files:** ${row.files.join(", ")}\n` : ""
  }`;
  try {
    appendFileSync(SESSION_MD, md, "utf8");
  } catch {
    writeFileSync(
      SESSION_MD,
      `# Hackerman agent logs\n\nSecrets are redacted. One entry per implementation step.\n${md}`,
      "utf8",
    );
  }
}

export function logAgentRun(input: {
  node: string;
  user_prompt: string;
  summary: string;
  ok: boolean;
  payload?: unknown;
}) {
  const ts = new Date().toISOString();
  const row = {
    ts,
    node: input.node,
    user_prompt: redactString(input.user_prompt),
    summary: redactString(input.summary),
    ok: input.ok,
    payload: redact(input.payload),
  };
  appendJsonl(RUNS_JSONL, row);
  const trace: AgentTrace = {
    id: crypto.randomUUID(),
    ts,
    name: input.node,
    input: redactString(input.user_prompt),
    output: redactString(input.summary),
    ok: input.ok,
    metadata: redact(input.payload),
  };
  appendJsonl(TRACES_JSONL, trace);
  if (shouldExportToLangfuse(input.node)) {
    void ingestLangfuse(trace);
  }
}

export function readLocalTraces(limit = 40): AgentTrace[] {
  if (!existsSync(TRACES_JSONL) && !existsSync(RUNS_JSONL)) return [];
  const path = existsSync(TRACES_JSONL) ? TRACES_JSONL : RUNS_JSONL;
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).slice(-limit);
  const traces: AgentTrace[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as Partial<AgentTrace> & {
        node?: string;
        user_prompt?: string;
        summary?: string;
      };
      traces.push({
        id: row.id ?? crypto.randomUUID(),
        ts: row.ts ?? new Date().toISOString(),
        name: row.name ?? row.node ?? "run",
        input: row.input ?? row.user_prompt ?? "",
        output: row.output ?? row.summary ?? "",
        ok: row.ok ?? true,
        metadata: row.metadata,
      });
    } catch {
      /* skip bad line */
    }
  }
  return traces.reverse();
}
