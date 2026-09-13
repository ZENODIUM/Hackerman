import { genericBrief } from "@/lib/hackathon";
import { createHackathon, getState, selectHackathon, updateBrief } from "@/lib/store";
import type { HackathonBrief } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    action?: string;
    id?: string;
    brief?: Partial<HackathonBrief>;
  };
  if (body.action === "create") {
    return Response.json({ state: createHackathon(body.brief ? { ...genericBrief(), ...body.brief } : undefined) });
  }
  if (body.action === "select" && body.id) {
    return Response.json({ state: selectHackathon(body.id) });
  }
  if (body.action === "updateBrief") {
    updateBrief(body.brief ?? {});
    return Response.json({ state: getState() });
  }
  return Response.json({ error: "unknown action" }, { status: 400 });
}
