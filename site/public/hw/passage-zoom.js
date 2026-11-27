// Click-to-zoom for the reading passages. Classic (non-module) script so it runs on its own.
(function () {
// Click-to-zoom for the reading passages (lightbox).
// A passage is lifted out of the grid (a hidden placeholder keeps its slot), centered with
// position: fixed, and animated with a FLIP transition from/to its place in the page.
// Click the passage again, click the backdrop, or press Esc to close it.
function initPassageZoom() {
  const passages = [...document.querySelectorAll(".passage")];
  if (!passages.length) return;

  const backdrop = document.createElement("div");
  backdrop.className = "passage-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  document.body.append(backdrop);
  // the page behind the dimmed overlay should not scroll
  backdrop.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
  backdrop.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  let active = null; // { el, ph } while a passage is zoomed (and not closing)
  const closing = new Set();

  // transform that makes the zoomed (centered) box coincide with `rect`
  function invert(el, rect) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const dx = rect.left + rect.width / 2 - (vw / 2 + w / 2);
    const dy = rect.top + rect.height / 2 - (vh / 2 + h / 2);
    return `translate(${dx}px, ${dy}px) scale(${rect.width / w})`;
  }

  function open(el) {
    if (active) closeNow(active);
    const first = el.getBoundingClientRect();
    const ph = document.createElement("div");
    ph.className = "passage-placeholder";
    ph.setAttribute("aria-hidden", "true");
    ph.style.height = `${el.offsetHeight}px`;
    el.after(ph);

    el.classList.add("passage-zoomed");
    el.scrollTop = 0;
    el.style.transform = invert(el, first); // start where the card was
    void el.offsetWidth; // commit the start state
    el.classList.add("passage-zooming"); // turns the CSS transition on
    el.style.transform = ""; // end state comes from .passage-zoomed
    backdrop.classList.add("is-open");
    el.setAttribute("aria-expanded", "true");
    active = { el, ph };

    afterTransition(el, () => el.classList.remove("passage-zooming"));
  }

  function close() {
    if (!active) return;
    const { el, ph } = active;
    active = null;
    closing.add(el);
    el.scrollTop = 0;
    el.classList.add("passage-zooming");
    backdrop.classList.remove("is-open");
    el.style.transform = invert(el, ph.getBoundingClientRect());
    afterTransition(el, () => cleanup(el, ph));
  }

  function closeNow({ el, ph }) {
    active = null;
    backdrop.classList.remove("is-open");
    cleanup(el, ph);
  }

  function cleanup(el, ph) {
    el.classList.remove("passage-zoomed", "passage-zooming");
    el.style.transform = "";
    el.setAttribute("aria-expanded", "false");
    ph.remove();
    closing.delete(el);
  }

  // runs fn once, when the transform transition ends (or after a timeout if it never runs,
  // e.g. with reduced motion)
  function afterTransition(el, fn) {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      fn();
    };
    const onEnd = (e) => {
      if (e.target === el && e.propertyName === "transform") finish();
    };
    el.addEventListener("transitionend", onEnd);
    setTimeout(finish, 600);
  }

  function toggle(el) {
    if (closing.has(el)) return;
    if (active && active.el === el) close();
    else open(el);
  }

  passages.forEach((el) => {
    el.tabIndex = 0;
    el.setAttribute("aria-expanded", "false");
    el.addEventListener("click", () => {
      // dragging to select text inside the zoomed passage should not close it
      if (active && active.el === el && String(window.getSelection()).length) return;
      toggle(el);
    });
    el.addEventListener("keydown", (e) => {
      if (e.target !== el) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle(el);
      }
    });
  });

  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

  initPassageZoom();
})();
