// Sidenotes: in the right margin on desktop (pure CSS, see base.css), an inline
// "show passage" toggle under 900px. Call initSidenotes() again after adding notes.

export function initSidenotes(root = document) {
  let n = 0;
  for (const note of root.querySelectorAll(".sidenote")) {
    const btn = note.querySelector(".sidenote-toggle");
    const body = note.querySelector(".sidenote-body");
    if (!btn || !body || btn.dataset.wired) continue;
    btn.dataset.wired = "1";
    body.id ||= `sidenote-${Date.now().toString(36)}-${n++}`;
    btn.setAttribute("aria-controls", body.id);
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", () => {
      const open = note.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", String(open));
    });
  }
}
