import { deriveChecklist } from "@/lib/checklist";
import { connectionStatus } from "@/lib/env";
import { langfuseConfigured } from "@/lib/langfuse";
import { readLocalTraces } from "@/lib/logger";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = getState();
  return Response.json({
    state,
    connections: connectionStatus(),
    checklist: deriveChecklist(state),
    traces: readLocalTraces(40),
    langfuse: langfuseConfigured(),
  });
}
