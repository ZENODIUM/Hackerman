import { fetchLangfuseTraces, langfuseConfigured } from "@/lib/langfuse";
import { readLocalTraces } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const local = readLocalTraces(50);
  const remote = langfuseConfigured() ? await fetchLangfuseTraces(8) : [];
  return Response.json({
    langfuse: langfuseConfigured(),
    traces: [...remote, ...local].slice(0, 60),
  });
}
