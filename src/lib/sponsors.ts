export const SPONSOR_TOOLS: { keyword: string; prize: string }[] = [
  { keyword: "next", prize: "Best Next.js / Vercel use" },
  { keyword: "langchain", prize: "Best agent stack" },
  { keyword: "langgraph", prize: "Best multi-agent orchestration" },
  { keyword: "discord", prize: "Best community integration" },
  { keyword: "gemini", prize: "Best Gemini / multimodal use" },
  { keyword: "resend", prize: "Best transactional email" },
];

export function matchSponsors(stack: string[]): string[] {
  const hay = stack.join(" ").toLowerCase();
  return SPONSOR_TOOLS.filter((s) => hay.includes(s.keyword)).map((s) => s.prize);
}
