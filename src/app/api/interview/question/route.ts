import { interviewQuestion } from "@/lib/agents/interview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const question = await interviewQuestion();
  return Response.json({ question, seconds: 15 });
}
