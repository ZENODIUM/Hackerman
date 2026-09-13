const PATTERNS: RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bghp_[0-9A-Za-z]{20,}\b/g,
  /\bgithub_pat_[0-9A-Za-z_]{20,}\b/g,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g,
  /\bre_[0-9A-Za-z]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi,
  /\b(sk|rk|pk)[-_]live[-_][A-Za-z0-9]+/gi,
  /((?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)\s*[=:]\s*)(["']?)[^\s"'&]+/gi,
];

export function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|authorization/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

export function redactString(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}
