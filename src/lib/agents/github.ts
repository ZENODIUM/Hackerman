import "server-only";

import { env, githubRepos, githubStallHours } from "@/lib/env";
import { sleep } from "@/lib/ids";
import { matchSponsors } from "@/lib/sponsors";
import { addActivity, patchPipeline, replaceTeams } from "@/lib/store";
import type { Activity, Team, TeamHealth } from "@/lib/types";

const API = "https://api.github.com";

function headers(): HeadersInit {
  const token = env("GITHUB_TOKEN");
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "hackerman",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function classify(commits: { commit?: { committer?: { date?: string } } }[], hasReadme: boolean): TeamHealth {
  if (!commits.length) return "stalled";
  const last = commits[0]?.commit?.committer?.date;
  const ageH = last ? (Date.now() - new Date(last).getTime()) / 36e5 : 99;
  // Configurable: GITHUB_STALL_HOURS (default 5). Empty repos still stall.
  if (ageH > githubStallHours()) return "stalled";
  if (commits.length >= 8 && !hasReadme) return "noisy";
  return "healthy";
}

function detectFromText(decoded: string, filename: string): string[] {
  const stack: string[] = [];
  if (decoded.includes("next")) stack.push("next");
  if (decoded.includes("langgraph") || decoded.includes("@langchain")) stack.push("langgraph", "langchain");
  if (decoded.includes("discord")) stack.push("discord");
  if (decoded.includes("gemini") || decoded.includes("@google/generative-ai")) stack.push("gemini");
  if (decoded.includes("resend")) stack.push("resend");
  if (filename.endsWith(".txt") || filename.includes("py") || decoded.includes("django") || decoded.includes("fastapi")) {
    stack.push("python");
  }
  return stack;
}

function fixtureTeams(): Team[] {
  const owner = env("GITHUB_OWNER") ?? "demo";
  return [
    {
      id: `${owner}/team-healthy`,
      name: "team-healthy",
      repo: `${owner}/team-healthy`,
      health: "healthy",
      lastCommit: new Date().toISOString(),
      commitCount: 6,
      stack: ["next", "langgraph"],
      notes: "Fixture: recent commits.",
    },
    {
      id: `${owner}/team-stalled`,
      name: "team-stalled",
      repo: `${owner}/team-stalled`,
      health: "stalled",
      lastCommit: new Date(Date.now() - 12 * 36e5).toISOString(),
      commitCount: 1,
      stack: ["python"],
      notes: "Fixture: no commit in 12h.",
    },
    {
      id: `${owner}/team-noisy`,
      name: "team-noisy",
      repo: `${owner}/team-noisy`,
      health: "noisy",
      lastCommit: new Date().toISOString(),
      commitCount: 14,
      stack: ["next"],
      notes: "Fixture: many commits, weak README.",
    },
  ];
}

async function inspectRepo(owner: string, repo: string): Promise<Team> {
  const commitsRes = await fetch(`${API}/repos/${owner}/${repo}/commits?per_page=20`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!commitsRes.ok) {
    if (commitsRes.status === 409 || commitsRes.status === 404) {
      return {
        id: `${owner}/${repo}`,
        name: repo,
        repo: `${owner}/${repo}`,
        health: "stalled",
        commitCount: 0,
        stack: [],
        notes: "Empty or missing repo — treated as stalled.",
      };
    }
    throw new Error(`GitHub ${owner}/${repo} commits ${commitsRes.status}`);
  }
  const commits = (await commitsRes.json()) as { commit?: { committer?: { date?: string } } }[];
  const readmeRes = await fetch(`${API}/repos/${owner}/${repo}/readme`, {
    headers: headers(),
    cache: "no-store",
  });
  const hasReadme = readmeRes.ok;
  let stack: string[] = [];
  const meta = await fetch(`${API}/repos/${owner}/${repo}`, { headers: headers(), cache: "no-store" });
  if (meta.ok) {
    const body = (await meta.json()) as { language?: string };
    const lang = (body.language ?? "").toLowerCase();
    if (lang.includes("python")) stack.push("python");
    if (lang.includes("type") || lang.includes("javascript")) stack.push("javascript");
  }
  const langs = await fetch(`${API}/repos/${owner}/${repo}/languages`, { headers: headers(), cache: "no-store" });
  if (langs.ok) {
    const body = (await langs.json()) as Record<string, number>;
    if (body.Python) stack.push("python");
    if (body.TypeScript || body.JavaScript) stack.push("javascript");
    if (body.Rust) stack.push("rust");
  }
  for (const file of ["package.json", "requirements.txt", "Cargo.toml", "pyproject.toml"]) {
    const r = await fetch(`${API}/repos/${owner}/${repo}/contents/${file}`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!r.ok) continue;
    const body = (await r.json()) as { content?: string };
    const decoded = body.content ? Buffer.from(body.content, "base64").toString("utf8").toLowerCase() : "";
    stack.push(...detectFromText(decoded, file));
  }
  stack = [...new Set(stack)];
  const health = classify(commits, hasReadme);
  const last = commits[0]?.commit?.committer?.date;
  const prizes = matchSponsors(stack);
  const notes = [
    hasReadme ? "README ok" : "Missing README",
    `${commits.length} recent commits`,
    prizes.length ? `Sponsor: ${prizes.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" / ");
  return {
    id: `${owner}/${repo}`,
    name: repo,
    repo: `${owner}/${repo}`,
    health,
    lastCommit: last,
    commitCount: commits.length,
    stack,
    prizes,
    notes,
  };
}

export async function checkHealth(): Promise<{ teams: Team[]; activity: Activity; live: boolean; stalled: string[] }> {
  const owner = env("GITHUB_OWNER");
  const live = Boolean(env("GITHUB_TOKEN") && owner);
  let teams: Team[];

  if (live) {
    teams = [];
    for (const repo of githubRepos()) {
      try {
        teams.push(await inspectRepo(owner!, repo));
      } catch (err) {
        teams.push({
          id: `${owner}/${repo}`,
          name: repo,
          repo: `${owner}/${repo}`,
          health: "unknown",
          commitCount: 0,
          stack: [],
          notes: err instanceof Error ? err.message : "inspect failed",
        });
      }
    }
  } else {
    teams = fixtureTeams();
  }

  replaceTeams(teams);
  patchPipeline({ githubScanned: true });
  const stalled = teams.filter((t) => t.health === "stalled").map((t) => t.repo);
  const activity = addActivity({
    agent: "progress",
    title: live ? "GitHub health scan" : "GitHub fixture scan",
    detail: teams.map((t) => `${t.name}: ${t.health}`).join(" / "),
    ok: true,
    payload: { teams, live, stalled, stallHours: githubStallHours() },
  });
  return { teams, activity, live, stalled };
}

async function ownerType(owner: string): Promise<"User" | "Organization"> {
  const res = await fetch(`${API}/users/${owner}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) return "User";
  const json = (await res.json()) as { type?: string };
  return json.type === "Organization" ? "Organization" : "User";
}

async function repoExists(owner: string, repo: string): Promise<boolean> {
  const res = await fetch(`${API}/repos/${owner}/${repo}`, { headers: headers(), cache: "no-store" });
  return res.ok;
}

async function repoFileExists(owner: string, repo: string, path: string): Promise<boolean> {
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  return res.ok;
}

async function putFile(owner: string, repo: string, path: string, content: string, message: string) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString("base64"),
    }),
  });
  if (!res.ok) throw new Error(`GitHub put ${path} ${res.status}: ${await res.text()}`);
}

export async function ensureRepos(): Promise<{ activity: Activity; live: boolean; created: string[] }> {
  const owner = env("GITHUB_OWNER");
  const live = Boolean(env("GITHUB_TOKEN") && owner);
  const names = githubRepos();
  if (!live) {
    const activity = addActivity({
      agent: "progress",
      title: "GitHub repos (dry run)",
      detail: `Would create ${names.join(", ")} under ${owner ?? "GITHUB_OWNER"}.`,
      ok: true,
    });
    return { activity, live: false, created: [] };
  }

  const kind = await ownerType(owner!);
  const createUrl = kind === "Organization" ? `${API}/orgs/${owner}/repos` : `${API}/user/repos`;
  const created: string[] = [];
  const reused: string[] = [];

  for (const name of names) {
    if (await repoExists(owner!, name)) {
      reused.push(name);
      continue;
    }
    const autoInit = name.includes("healthy");
    const res = await fetch(createUrl, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name,
        description: `Hackerman team repo (${name})`,
        auto_init: autoInit,
        private: false,
      }),
    });
    if (!res.ok && res.status !== 422) {
      throw new Error(`GitHub create ${name} ${res.status}: ${await res.text()}`);
    }
    created.push(name);
    await sleep(400);
  }

  for (const name of names) {
    if (!(await repoExists(owner!, name))) continue;
    if (created.includes(name) && name.includes("noisy")) {
      for (let i = 1; i <= 8; i += 1) {
        await putFile(owner!, name, `scratch-${i}.txt`, `note ${i}\n`, `wip ${i}`);
        await sleep(200);
      }
    }
    if (name.includes("noisy") && !(await repoFileExists(owner!, name, "package.json"))) {
      await putFile(
        owner!,
        name,
        "package.json",
        `${JSON.stringify({ name, dependencies: { next: "16.0.0" } }, null, 2)}\n`,
        "add next manifest for sponsor scan",
      );
    }
    if (name.includes("healthy") && !(await repoFileExists(owner!, name, "package.json"))) {
      await putFile(
        owner!,
        name,
        "package.json",
        `${JSON.stringify(
          {
            name,
            dependencies: {
              next: "16.0.0",
              "@langchain/langgraph": "1.0.0",
              "discord.js": "14.0.0",
              "@google/generative-ai": "0.24.0",
              resend: "4.0.0",
            },
          },
          null,
          2,
        )}\n`,
        "add stack manifest for sponsor scan",
      );
    }
  }

  patchPipeline({ githubReposCreated: true });
  const activity = addActivity({
    agent: "progress",
    title: created.length ? "Created GitHub team repos" : "GitHub repos already exist",
    detail: `Owner ${owner} (${kind}). Created: ${created.join(", ") || "none"}. Reused: ${reused.join(", ") || "none"}.`,
    ok: true,
    payload: { created, reused, live: true },
  });
  return { activity, live: true, created };
}

export async function openIssue(repo: string, title: string, body: string): Promise<Activity> {
  const owner = env("GITHUB_OWNER");
  if (!env("GITHUB_TOKEN") || !owner) {
    return addActivity({
      agent: "progress",
      title: "GitHub issue (dry run)",
      detail: `${repo}: ${title}`,
      ok: true,
      payload: { dry: true },
    });
  }
  const name = repo.includes("/") ? repo.split("/")[1] : repo;
  const res = await fetch(`${API}/repos/${owner}/${name}/issues`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ title, body }),
  });
  if (!res.ok) throw new Error(`GitHub issue ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { html_url?: string };
  return addActivity({
    agent: "progress",
    title: "Opened GitHub issue",
    detail: json.html_url ?? title,
    ok: true,
    payload: { url: json.html_url },
  });
}

export async function remindSponsors(teams?: Team[]): Promise<Activity> {
  const list = teams ?? (await checkHealth()).teams;
  const hits = list
    .map((t) => ({ t, prizes: matchSponsors(t.stack) }))
    .filter((x) => x.prizes.length);
  return addActivity({
    agent: "progress",
    title: "Sponsor-tool scan",
    detail: hits.length
      ? hits.map((h) => `${h.t.name} → ${h.prizes.join(", ")}`).join(" · ")
      : "No sponsor-stack matches.",
    ok: true,
    payload: { hits },
  });
}
