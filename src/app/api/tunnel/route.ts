export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NgrokTunnel = {
  public_url?: string;
  proto?: string;
};

type NgrokApi = {
  tunnels?: NgrokTunnel[];
};

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels", { cache: "no-store" });
    if (!res.ok) return Response.json({ online: false });
    const json = (await res.json()) as NgrokApi;
    const https = json.tunnels?.find((t) => t.proto === "https" && t.public_url) ?? json.tunnels?.find((t) => t.public_url);
    const origin = https?.public_url?.replace(/\/$/, "");
    if (!origin) return Response.json({ online: false });
    return Response.json({
      online: true,
      origin,
      interviewUrl: `${origin}/interview`,
      interactionsUrl: `${origin}/api/discord/interactions`,
    });
  } catch {
    return Response.json({ online: false });
  }
}
