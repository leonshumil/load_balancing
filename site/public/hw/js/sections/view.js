// Read: a "Mark as read" tick per passage; the section is done when all are ticked.
// Watch: done at 90% of the video or when it ends (see watchMode in model.js for how, per source).
import * as store from "../../../shared/store.js";
import { toggleRead, readDone, cleanRead, watchMode, watchedEnough } from "./model.js";

const READ_KEY = "hw:read";

export function initRead({ section, progress }) {
  if (!section) return;
  const cards = [...section.querySelectorAll(".passage")];
  const ids = cards.map((a) => (a.getAttribute("aria-labelledby") ?? "").replace(/-title$/, "")).filter(Boolean);
  let read = cleanRead(store.get(READ_KEY), ids);
  const count = document.createElement("p");
  count.className = "read-count";
  count.setAttribute("role", "status");
  section.querySelector(".section-head")?.append(count);

  const buttons = cards.map((card, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "passage-tick";
    // The card itself zooms on click (passage-zoom.js); the tick must not.
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      read = toggleRead(read, ids[i]);
      store.set(READ_KEY, read);
      render();
    });
    b.addEventListener("keydown", (e) => e.stopPropagation());
    card.append(b);
    return b;
  });

  function render() {
    buttons.forEach((b, i) => {
      const on = read.includes(ids[i]);
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on ? "✓ Read" : "○ Mark as read";
      b.setAttribute("aria-label", `${on ? "Read" : "Mark as read"}: passage ${i + 1}`);
    });
    count.textContent = `${read.length} of ${ids.length} passages read`;
    progress.setDone("read", readDone(read, ids));
  }
  render();
}

export function initWatch({ section, progress }) {
  if (!section) return;
  const media = section.querySelector("video, iframe");
  const status = document.createElement("p");
  status.className = "watch-status";
  status.setAttribute("role", "status");
  section.append(status);
  let marked = false;
  const done = () => { if (marked) return; marked = true; progress.setDone("watch"); show(); };
  const show = () => {
    const isDone = (store.get("hw:done", []) ?? []).includes("watch");
    status.textContent = isDone ? "✓ Watched" : "";
    status.hidden = !isDone;
  };
  const mode = watchMode(media ? { tag: media.tagName, src: media.getAttribute("src") ?? media.querySelector("source")?.getAttribute("src") ?? "" } : null);
  if (mode === "ended") {
    media.addEventListener("ended", done);
    media.addEventListener("timeupdate", () => { if (watchedEnough(media.currentTime, media.duration)) done(); });
  } else if (mode === "youtube") {
    const url = new URL(media.src);
    if (url.searchParams.get("enablejsapi") !== "1") { url.searchParams.set("enablejsapi", "1"); media.src = url.toString(); }
    const hook = () => new globalThis.YT.Player(media, { events: { onStateChange: (e) => { if (e.data === 0) done(); } } });
    if (globalThis.YT?.Player) hook();
    else {
      const prev = globalThis.onYouTubeIframeAPIReady;
      globalThis.onYouTubeIframeAPIReady = () => { prev?.(); hook(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.append(s);
    }
  } else {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost";
    b.textContent = "Mark as watched";
    b.addEventListener("click", done);
    section.append(b);
  }
  show();
}
