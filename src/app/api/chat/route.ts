import { runSupervisor } from "@/lib/graph";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json()) as { message?: string; force?: string };
  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message required" }, { status: 400 });
  }
  try {
    const result = await runSupervisor(message, body.force);
    return Response.json({
      reply: result.reply || "Done.",
      activities: result.activities,
      state: getState(),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "graph failed";
    return Response.json({ error: detail }, { status: 500 });
  }
}
