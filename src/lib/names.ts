/** Eventbrite sometimes returns profile.name as Python bytes repr: b'Vishnu' b'S'. */

function unwrapPyBytes(value: string): string {
  const trimmed = value.trim();
  const pieces = [...trimmed.matchAll(/\bb(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) =>
    m[2].replace(/\\(['"\\])/g, "$1"),
  );
  if (pieces.length) return pieces.join(" ").replace(/\s+/g, " ").trim();
  return trimmed.replace(/\s+/g, " ");
}

export function cleanPersonName(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const o = raw as { text?: unknown; first_name?: unknown; last_name?: unknown };
    if (typeof o.text === "string" && o.text.trim()) return cleanPersonName(o.text);
    const joined = [o.first_name, o.last_name]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map(unwrapPyBytes)
      .join(" ")
      .trim();
    if (joined) return joined;
  }
  if (typeof raw !== "string") return "";
  return unwrapPyBytes(raw);
}

export function attendeeDisplayName(profile?: {
  name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
}): string {
  const fromParts = [profile?.first_name, profile?.last_name]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map(unwrapPyBytes)
    .join(" ")
    .trim();
  if (fromParts) return fromParts;
  return cleanPersonName(profile?.name) || "Unknown";
}
