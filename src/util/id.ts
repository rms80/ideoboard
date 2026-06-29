/** Stable unique id generator used across the app (nodes, results, boxes, tags, images). */
export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback (non-secure contexts).
  return "id-" + Math.abs(hashNow()).toString(36) + "-" + counter().toString(36);
}

let _c = 0;
function counter(): number {
  return _c++;
}
function hashNow(): number {
  // Avoid Date.now/Math.random brittleness concerns elsewhere; this is a fallback only.
  return performance.now() * 1000;
}
