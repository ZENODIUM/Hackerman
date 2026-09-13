import { DEMO_STEPS, runDemoStep, type DemoStep } from "@/lib/demo";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as { step?: string };
  const step = body.step as DemoStep;
  if (!DEMO_STEPS.includes(step)) {
    return Response.json({ error: `step must be ${DEMO_STEPS.join(", ")}` }, { status: 400 });
  }
  try {
    const result = await runDemoStep(step);
    return Response.json({ ...result, state: getState() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "demo failed" },
      { status: 500 },
    );
  }
}
