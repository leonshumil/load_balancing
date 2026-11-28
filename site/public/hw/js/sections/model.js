// Completion rules for the Read and Watch sections (pure; the DOM side is in view.js).

/** Tick or untick one passage; returns a new sorted list without duplicates. */
export function toggleRead(list, id) {
  const s = new Set(list);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  return [...s].sort();
}

/** Read is done when every passage on the page is ticked (and there is at least one). */
export const readDone = (list, ids) => ids.length > 0 && ids.every((id) => list.includes(id));

/** A stored list, checked: only ids of passages on the page, once each. */
export function cleanRead(raw, ids) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id) => typeof id === "string" && ids.includes(id)))].sort();
}

/** Watch counts as done once 90% of the video has played (a fixed duration is needed). */
export const watchedEnough = (currentTime, duration) =>
  Number.isFinite(duration) && duration > 0 && currentTime / duration >= 0.9;

/**
 * How to tell that the video was watched to the end:
 *  "ended"   an HTML <video>: its own ended event;
 *  "youtube" a YouTube embed: the IFrame API's ENDED state;
 *  "button"  anything else (Google Drive, other players) can't report it: a "Mark as watched" button.
 */
export function watchMode(el) {
  if (!el) return "button";
  if (el.tag === "VIDEO") return "ended";
  if (el.tag === "IFRAME" && /^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//.test(el.src ?? "")) return "youtube";
  return "button";
}
