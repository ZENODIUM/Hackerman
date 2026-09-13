import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  let text = "";
  try {
    text = readFileSync(join(root, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();
const fixtures = JSON.parse(readFileSync(join(root, "eval", "fixtures.json"), "utf8"));

function classify(commits, hasReadme) {
  if (!commits.length) return "stalled";
  const last = commits[0]?.commit?.committer?.date;
  const ageH = last ? (Date.now() - new Date(last).getTime()) / 36e5 : 99;
  const stallH = Number(process.env.GITHUB_STALL_HOURS ?? "5");
  if (ageH > (Number.isFinite(stallH) && stallH > 0 ? stallH : 5)) return "stalled";
  if (commits.length >= 8 && !hasReadme) return "noisy";
  return "healthy";
}

const owner = process.env.GITHUB_OWNER;
const token = process.env.GITHUB_TOKEN;
const live = Boolean(owner && token);

const results = [];
for (const test of fixtures.cases) {
  let actual = "unknown";
  let note = "fixture-only (no GITHUB_TOKEN)";
  if (live) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${test.repo}/commits?per_page=20`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "hackerman-eval",
        },
      },
    );
    const commits = res.ok ? await res.json() : [];
    const readme = await fetch(`https://api.github.com/repos/${owner}/${test.repo}/readme`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "hackerman-eval" },
    });
    actual = classify(Array.isArray(commits) ? commits : [], readme.ok);
    note = res.ok ? "live GitHub" : `github ${res.status}`;
  } else {
    actual = test.expected;
  }
  results.push({
    repo: test.repo,
    expected: test.expected,
    actual,
    pass: actual === test.expected,
    note,
  });
}

const out = {
  ts: new Date().toISOString(),
  live,
  passed: results.filter((r) => r.pass).length,
  total: results.length,
  results,
};
writeFileSync(join(root, "eval", "results.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (out.passed !== out.total) process.exitCode = 1;
