import { runInterview, saveInterviewClip } from "@/lib/agents/interview";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function fromForm(req: Request) {
  const form = await req.formData();
  const transcript = String(form.get("transcript") ?? "");
  const teamId = String(form.get("teamId") ?? "") || undefined;
  let frames: string[] = [];
  const rawFrames = form.get("frames");
  if (typeof rawFrames === "string" && rawFrames) {
    try {
      frames = JSON.parse(rawFrames) as string[];
    } catch {
      frames = [];
    }
  }
  const file = form.get("video");
  let clipUrl: string | undefined;
  const id = crypto.randomUUID();
  if (file instanceof Blob && file.size > 0) {
    const bytes = Buffer.from(await file.arrayBuffer());
    clipUrl = saveInterviewClip(id, bytes, file.type || "video/webm");
  }
  return runInterview({ id, transcript, teamId, frames, clipUrl });
}

export async function POST(req: Request) {
  try {
    const ctype = req.headers.get("content-type") ?? "";
    const result = ctype.includes("multipart/form-data")
      ? await fromForm(req)
      : await (async () => {
          const body = (await req.json()) as {
            transcript?: string;
            teamId?: string;
            frames?: string[];
          };
          if (!body.transcript?.trim() && !body.frames?.length) {
            throw new Error("transcript or frames required");
          }
          return runInterview({
            transcript: body.transcript ?? "",
            teamId: body.teamId,
            frames: body.frames,
          });
        })();
    return Response.json({ ...result, state: getState() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "interview failed" },
      { status: 500 },
    );
  }
}
