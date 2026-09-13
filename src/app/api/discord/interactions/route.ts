import nacl from "tweetnacl";
import { formatStatusMessage } from "@/lib/agents/discord";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyDiscord(body: string, signature: string | null, timestamp: string | null) {
  const key = env("DISCORD_PUBLIC_KEY");
  if (!key || !signature || !timestamp) return false;
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + body),
      Buffer.from(signature, "hex"),
      Buffer.from(key, "hex"),
    );
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  if (!verifyDiscord(body, signature, timestamp)) {
    return new Response("invalid request signature", { status: 401 });
  }
  const payload = JSON.parse(body) as { type?: number; data?: { name?: string } };
  if (payload.type === 1) {
    return Response.json({ type: 1 });
  }
  if (payload.type === 2 && payload.data?.name === "status") {
    return Response.json({
      type: 4,
      data: { content: formatStatusMessage(), flags: 64 },
    });
  }
  return Response.json({
    type: 4,
    data: { content: "Unknown command.", flags: 64 },
  });
}
