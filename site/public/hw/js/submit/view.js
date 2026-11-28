// Submit (step 07): name, email and a question for the class, sent to Leon by email (Web3Forms)
// with a short summary of the homework. Name, email and the question draft are kept in the store.
import * as store from "../../../shared/store.js";
import { WEB3FORMS_KEY } from "../../../shared/config.js";
import { validate, collect, buildSummary, payload, send, QUESTION_MAX } from "./model.js";

const KEY = "hw:submit";

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...children.flat().filter((c) => c != null && c !== false));
  return e;
}

export function initSubmit({ root }) {
  if (!root) return;
  const saved = store.get(KEY, {}) ?? {};
  let sentAt = typeof saved.sentAt === "string" ? saved.sentAt : null;
  const save = () => store.set(KEY, { name: name.value, email: email.value, question: question.value, sentAt });

  const field = (id, labelText, control, hint) => {
    const err = h("p", { class: "sub-err", id: `${id}-err` });
    control.id = id;
    control.setAttribute("aria-describedby", `${id}-err`);
    return { el: h("div", { class: "sub-field" }, h("label", { class: "sub-label", for: id }, labelText), control, hint, err), err, control };
  };
  const name = h("input", { class: "input", type: "text", name: "name", autocomplete: "name", maxlength: "100", required: true });
  const email = h("input", { class: "input", type: "email", name: "email", autocomplete: "email", maxlength: "200", required: true });
  const question = h("textarea", { class: "input", name: "question", rows: "4", maxlength: String(QUESTION_MAX + 50), required: true,
    placeholder: "Something from CONGA you'd like us to discuss in class…" });
  const counter = h("span", { class: "sub-count", "aria-live": "polite" });
  // honeypot: hidden from people, filled only by bots (then nothing is sent)
  const botcheck = h("input", { type: "checkbox", name: "botcheck", tabindex: "-1", autocomplete: "off", class: "sub-hp", "aria-hidden": "true" });
  name.value = saved.name ?? "";
  email.value = saved.email ?? "";
  question.value = saved.question ?? "";

  const F = {
    name: field("sub-name", "Name", name),
    email: field("sub-email", "Email", email),
    question: field("sub-question", "Your question for the class", question, counter),
  };
  const summaryBox = h("pre", { class: "sub-summary", "aria-label": "What will be attached" });
  const sendBtn = h("button", { class: "btn btn-primary", type: "submit" }, "Send");
  const status = h("p", { class: "sub-status", role: "status" });
  const again = h("button", { class: "btn btn-ghost", type: "button", hidden: true, onclick: () => { sentAt = null; save(); render(); name.focus(); } }, "Send again");
  const fields = h("fieldset", { class: "sub-fields" }, h("legend", { class: "visually-hidden" }, "Your details and question"), F.name.el, F.email.el, F.question.el, botcheck);
  const form = h("form", { class: "sub-form", novalidate: true },
    fields,
    h("div", { class: "sub-actions" }, sendBtn, again, status));
  root.replaceChildren(h("div", { class: "sub-grid" },
    form,
    h("div", { class: "sub-attach" }, h("p", { class: "label" }, "Attached to your email (read only)"), summaryBox,
      h("p", { class: "sub-note" }, "Leon gets one email with your question and this summary, and can reply to you directly."))));

  const refreshSummary = () => { summaryBox.textContent = buildSummary(collect(store.get)); };
  const refreshCount = () => {
    const n = question.value.trim().length;
    counter.textContent = `${n} / ${QUESTION_MAX}`;
    counter.classList.toggle("is-over", n > QUESTION_MAX);
  };
  const showErrors = (errors) => {
    for (const [k, f] of Object.entries(F)) {
      f.err.textContent = errors[k] ?? "";
      if (errors[k]) f.control.setAttribute("aria-invalid", "true"); else f.control.removeAttribute("aria-invalid");
    }
  };

  function render() {
    const locked = !!sentAt;
    fields.disabled = locked;
    sendBtn.hidden = locked;
    again.hidden = !locked;
    if (locked) { status.className = "sub-status is-ok"; status.textContent = "Sent. Thanks, see you in class."; }
    refreshCount();
    refreshSummary();
  }

  for (const c of [name, email, question]) {
    c.addEventListener("input", () => {
      save();
      if (c === question) refreshCount();
      if (c.getAttribute("aria-invalid")) showErrors(validate({ name: name.value, email: email.value, question: question.value }).errors);
    });
  }
  // the summary follows the rest of the page: refresh it whenever the student comes back here
  root.addEventListener("focusin", refreshSummary);
  new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) refreshSummary(); }).observe(root);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sendBtn.disabled || sentAt) return;
    const v = validate({ name: name.value, email: email.value, question: question.value });
    showErrors(v.errors);
    if (!v.ok) { status.className = "sub-status"; status.textContent = ""; F[Object.keys(v.errors)[0]].control.focus(); return; }
    refreshSummary();
    const body = { ...payload({ key: WEB3FORMS_KEY, name: name.value, email: email.value, question: question.value, summary: summaryBox.textContent }), botcheck: botcheck.checked };
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    status.className = "sub-status";
    status.textContent = "";
    const r = await send(body);
    sendBtn.disabled = false;
    sendBtn.textContent = "Send";
    if (r.ok) {
      sentAt = new Date().toISOString();
      save();
      render();
      again.focus();
    } else {
      status.className = "sub-status is-bad";
      status.textContent = `Not sent: ${r.message}`;
    }
  });

  render();
}
