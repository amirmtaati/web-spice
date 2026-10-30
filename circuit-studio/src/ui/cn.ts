/** Join class names, skipping falsy values. Tiny local `cn` (no dep). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p) => typeof p === "string" && p.length > 0).join(" ");
}
