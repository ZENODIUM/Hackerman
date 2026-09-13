import "server-only";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env, geminiModel } from "@/lib/env";
import { addActivity, addInterview, patchPipeline } from "@/lib/store";
import type { Activity, InterviewRubric } from "@/lib/types";

function parseRubricJson(text: string): Partial<InterviewRubric> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Partial<InterviewRubric>;
  } catch {
    return {};
  }
}

function acceptedParse(parsed: Partial<InterviewRubric>): boolean {
  return typeof parsed.summary === "string" && parsed.summary.trim().length > 0;
}

export function saveInterviewClip(id: string, bytes: Buffer, mime: string) {
  const ext = mime.includes("mp4") ? "mp4" : "webm";
  const dir = join(process.cwd(), "data", "interviews");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.${ext}`), bytes);
  return `/api/interview/clip/${id}`;
}

export async function interviewQuestion(): Promise<string> {
  const fallback =
    "In fifteen seconds: what did you build, and how do the Eventbrite, GitHub, and Discord agents hand off?";
  if (!env("GEMINI_API_KEY")) return fallback;
  try {
    const model = new ChatGoogleGenerativeAI({
      apiKey: env("GEMINI_API_KEY"),
      model: geminiModel(),
      temperature: 0.4,
    });
    const res = await model.invoke([
      {
        role: "system",
        content:
          "You are a hackathon interviewer. Reply with ONE short spoken question, under 25 words. No quotes.",
      },
      {
        role: "user",
        content: "Ask the builder to explain the multi-agent handoff in 15 seconds.",
      },
    ]);
    const text = String(res.content).trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

function lastPreviewFrame(frames: string[]): string | undefined {
  const raw = frames.at(-1);
  if (!raw) return undefined;
  const stripped = raw.replace(/^data:image\/\w+;base64,/, "");
  return stripped.length && stripped.length < 180_000 ? stripped : undefined;
}

export async function runInterview(input: {
  id?: string;
  transcript: string;
  teamId?: string;
  frames?: string[];
  clipUrl?: string;
}): Promise<{ rubric: InterviewRubric; activity: Activity }> {
  const transcript = input.transcript.trim();
  const frames = (input.frames ?? []).filter((f) => f && f.length < 400_000).slice(0, 6);

  if (!transcript && !frames.length) throw new Error("Need a transcript or recorded frames");

  let summary = transcript.slice(0, 280) || "Video-only interview — no speech transcript captured.";
  let scriptLikelihood = transcript ? Math.min(0.95, transcript.length / 2000) : 0.4;
  let recommendAdvance = transcript.length > 40 || frames.length > 0;
  let answeredWithoutPrompt = /\b(we|I|our)\b/i.test(transcript);
  let eyeContactProxy = frames.length ? 0.5 : undefined;
  let toneNatural = transcript ? 0.5 : undefined;
  let readingFromScript = transcript ? Math.min(0.8, scriptLikelihood) : undefined;
  let scoredBy: InterviewRubric["scoredBy"] = "heuristic";
  let scoreError: string | undefined;

  if (env("GEMINI_API_KEY") && frames.length) {
    const genAI = new GoogleGenerativeAI(env("GEMINI_API_KEY")!);
    const model = genAI.getGenerativeModel({ model: geminiModel() });
    const parts = [
      {
        text: `You score a 15-second hackathon interview from webcam frames plus transcript.
Return ONLY JSON:
{"summary":string,"scriptLikelihood":0-1,"answeredWithoutPrompt":boolean,"recommendAdvance":boolean,"eyeContactProxy":0-1,"toneNatural":0-1,"readingFromScript":0-1}
Judge: eye contact vs looking down/side at another screen, whether they look like they are reading, whether tone/wording sounds natural vs recited.
Transcript:
${transcript || "(no speech captured)"}`,
      },
      ...frames.map((data) => ({
        inlineData: { mimeType: "image/jpeg", data: data.replace(/^data:image\/\w+;base64,/, "") },
      })),
    ];
    try {
      const result = await model.generateContent(parts);
      const raw = result.response.text();
      const parsed = parseRubricJson(raw);
      if (!acceptedParse(parsed)) {
        scoreError = "Gemini returned a response that was not valid rubric JSON — showing heuristic fallback.";
      } else {
        scoredBy = "gemini";
        summary = parsed.summary ?? summary;
        scriptLikelihood = Number(parsed.scriptLikelihood ?? scriptLikelihood);
        answeredWithoutPrompt = Boolean(parsed.answeredWithoutPrompt);
        recommendAdvance = Boolean(parsed.recommendAdvance);
        eyeContactProxy = Number(parsed.eyeContactProxy ?? eyeContactProxy ?? 0);
        toneNatural = Number(parsed.toneNatural ?? toneNatural ?? 0);
        readingFromScript = Number(parsed.readingFromScript ?? readingFromScript ?? 0);
      }
    } catch (err) {
      scoreError = err instanceof Error ? err.message : "Gemini video score failed — heuristic fallback.";
    }
  } else if (env("GEMINI_API_KEY") && transcript) {
    const model = new ChatGoogleGenerativeAI({
      apiKey: env("GEMINI_API_KEY"),
      model: geminiModel(),
      temperature: 0.2,
    });
    try {
      const res = await model.invoke([
        {
          role: "system",
          content:
            "You score a hackathon interview. Return ONLY JSON: {summary, scriptLikelihood (0-1), answeredWithoutPrompt, recommendAdvance, toneNatural (0-1), readingFromScript (0-1)}. No markdown.",
        },
        { role: "user", content: transcript },
      ]);
      const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      const parsed = parseRubricJson(text);
      if (!acceptedParse(parsed)) {
        scoreError = "Gemini returned a response that was not valid rubric JSON — showing heuristic fallback.";
      } else {
        scoredBy = "gemini";
        summary = parsed.summary ?? summary;
        scriptLikelihood = Number(parsed.scriptLikelihood ?? scriptLikelihood);
        answeredWithoutPrompt = Boolean(parsed.answeredWithoutPrompt);
        recommendAdvance = Boolean(parsed.recommendAdvance);
        toneNatural = Number(parsed.toneNatural ?? toneNatural ?? 0);
        readingFromScript = Number(parsed.readingFromScript ?? readingFromScript ?? 0);
      }
    } catch (err) {
      scoreError = err instanceof Error ? err.message : "Gemini text score failed — heuristic fallback.";
    }
  } else {
    scoreError = "No GEMINI_API_KEY — heuristic fallback.";
  }

  const rubric: InterviewRubric = {
    id: input.id ?? crypto.randomUUID(),
    teamId: input.teamId,
    ts: new Date().toISOString(),
    scriptLikelihood,
    answeredWithoutPrompt,
    eyeContactProxy,
    toneNatural,
    readingFromScript,
    summary,
    recommendAdvance,
    scoredBy,
    scoreError,
    clipUrl: input.clipUrl,
    previewFrame: lastPreviewFrame(frames),
  };
  addInterview(rubric);
  patchPipeline({ interviewDone: true });
  const activity = addActivity({
    agent: "interview",
    title: recommendAdvance ? "Interview: advance" : "Interview: hold",
    detail: `${scoredBy === "gemini" ? "GEMINI" : "HEURISTIC"} · ${summary} · script=${scriptLikelihood.toFixed(2)} eye=${(eyeContactProxy ?? 0).toFixed(2)} read=${(readingFromScript ?? 0).toFixed(2)}${scoreError ? ` · ${scoreError}` : ""}`,
    ok: scoredBy === "gemini",
    payload: { ...rubric, live: scoredBy === "gemini" },
  });
  return { rubric, activity };
}
