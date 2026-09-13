"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { InterviewRubric } from "@/lib/types";

const SECONDS = 15;

type Phase = "idle" | "ready" | "asking" | "recording" | "scoring" | "done";

export default function InterviewPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptRef = useRef("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [question, setQuestion] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(SECONDS);
  const [transcript, setTranscript] = useState("");
  const [rubric, setRubric] = useState<InterviewRubric | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function armCamera() {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    const res = await fetch("/api/interview/question", { cache: "no-store" });
    const json = (await res.json()) as { question?: string };
    setQuestion(json.question ?? "In fifteen seconds, what did you build?");
    setPhase("ready");
  }

  function speak(text: string) {
    return new Promise<void>((resolve) => {
      if (!window.speechSynthesis) {
        resolve();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    });
  }

  function startRecognition(): { stop: () => void } | null {
    const w = window as Window & {
      SpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        start: () => void;
        stop: () => void;
      };
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      let next = "";
      for (let i = 0; i < event.results.length; i += 1) {
        next += `${event.results[i][0].transcript} `;
      }
      transcriptRef.current = next.trim();
      setTranscript(next.trim());
    };
    rec.start();
    return rec;
  }

  async function extractFrames(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("could not read recording"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    const duration = Number.isFinite(video.duration) ? video.duration : SECONDS;
    const stamps = [0.5, 3, 6, 9, 12, Math.max(0.5, duration - 0.4)];
    const frames: string[] = [];
    for (const stamp of stamps) {
      if (stamp > duration) continue;
      video.currentTime = stamp;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const raw = canvas.toDataURL("image/jpeg", 0.42);
      frames.push(raw.split(",")[1] ?? "");
    }
    URL.revokeObjectURL(url);
    return frames.filter(Boolean);
  }

  async function begin() {
    if (!streamRef.current) return;
    setError(null);
    setPhase("asking");
    await speak(question);
    const recognition = startRecognition();
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(streamRef.current, { mimeType: mime });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.start(250);
    setPhase("recording");
    setSecondsLeft(SECONDS);
    const started = Date.now();
    const tick = window.setInterval(() => {
      setSecondsLeft(Math.max(0, SECONDS - Math.floor((Date.now() - started) / 1000)));
    }, 200);
    await new Promise((resolve) => window.setTimeout(resolve, SECONDS * 1000));
    window.clearInterval(tick);
    setSecondsLeft(0);
    recognition?.stop();
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    setPhase("scoring");
    try {
      const blob = new Blob(chunks, { type: mime });
      const localUrl = URL.createObjectURL(blob);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = localUrl;
        videoRef.current.muted = false;
      }
      const frames = await extractFrames(blob);
      const form = new FormData();
      form.append("video", blob, "interview.webm");
      form.append("transcript", transcriptRef.current);
      form.append("frames", JSON.stringify(frames));
      form.append("teamId", "demo");
      const res = await fetch("/api/interview", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "score failed");
      setRubric(json.rubric);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "score failed");
      setPhase("ready");
    } finally {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8">
      <Link href="/" className="btn-brutal btn-blue w-fit px-3 py-2 text-sm">
        BACK // COMMAND CENTER
      </Link>
      <header className="panel bg-[var(--accent)] p-5">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em]">
          hackerman // interview agent // 15s camera + voice
        </p>
        <h1 className="mt-2 text-5xl md:text-7xl">AI screen</h1>
        <p className="mt-3 text-[15px] leading-relaxed">
          Gemini asks one spoken question. Your webcam records 15 seconds. Frames + transcript go back to Gemini for
          eye contact, tone, and “reading from a script” scoring.
        </p>
      </header>

      <section className="panel space-y-4 bg-[var(--panel)] p-4">
        <video ref={videoRef} muted playsInline className="hard-border aspect-video w-full bg-black object-cover" />
        {question && (
          <p className="card-brutal bg-[var(--accent-5)] p-3 text-[15px] leading-relaxed">
            <span className="font-mono text-[10px] font-bold uppercase">Gemini asks // </span>
            {question}
          </p>
        )}
        <p className="font-mono text-xs font-bold uppercase">
          {phase === "recording" ? `RECORDING ${secondsLeft}s` : phase.toUpperCase()}
        </p>
        {transcript && <p className="text-sm leading-relaxed">{transcript}</p>}
        {phase === "idle" && (
          <button type="button" className="btn-brutal btn-pink px-5 py-3 text-lg" onClick={() => void armCamera()}>
            ENABLE CAMERA + MIC
          </button>
        )}
        {phase === "ready" && (
          <button type="button" className="btn-brutal btn-pink px-5 py-3 text-lg" onClick={() => void begin()}>
            START 15s INTERVIEW
          </button>
        )}
        {(phase === "asking" || phase === "recording" || phase === "scoring") && (
          <button type="button" disabled className="btn-brutal px-5 py-3 text-lg">
            {phase === "asking" ? "LISTENING TO GEMINI..." : phase === "recording" ? "SPEAK NOW" : "SCORING VIDEO..."}
          </button>
        )}
      </section>

      {error && <p className="hard-border bg-[var(--accent-2)] px-3 py-2 text-sm">ERR // {error}</p>}
      {rubric && (
        <section className="panel space-y-3 bg-[var(--accent-4)] p-4">
          <p className="font-mono text-xs font-bold uppercase">
            scored by {rubric.scoredBy}
            {rubric.scoreError ? ` · ${rubric.scoreError}` : ""}
          </p>
          {rubric.previewFrame && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Saved interview frame"
              src={`data:image/jpeg;base64,${rubric.previewFrame}`}
              className="hard-border aspect-video w-full bg-black object-cover"
            />
          )}
          {rubric.clipUrl && (
            <video src={rubric.clipUrl} controls playsInline className="hard-border aspect-video w-full bg-black" />
          )}
          <pre className="overflow-x-auto font-mono text-xs">{JSON.stringify(rubric, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
