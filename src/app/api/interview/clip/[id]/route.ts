import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return new Response("bad id", { status: 400 });
  }
  const dir = join(process.cwd(), "data", "interviews");
  const webm = join(dir, `${id}.webm`);
  const mp4 = join(dir, `${id}.mp4`);
  const path = existsSync(webm) ? webm : existsSync(mp4) ? mp4 : null;
  if (!path) return new Response("not found", { status: 404 });
  const bytes = readFileSync(path);
  return new Response(bytes, {
    headers: {
      "Content-Type": path.endsWith(".mp4") ? "video/mp4" : "video/webm",
      "Cache-Control": "no-store",
    },
  });
}
