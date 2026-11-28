// Submit by email (step 07): pure logic, no DOM. One email to Leon through Web3Forms
// (https://docs.web3forms.com): no database. The access key is public by design.
// Web3Forms uses `email` as the Reply-To; we also send `replyto` explicitly.

import { FORKS, TREE } from "../path/model.js";
import * as T from "../tutor/model.js";
import * as L from "../lab/state.js";

export const ENDPOINT = "https://api.web3forms.com/submit";
export const QUESTION_MIN = 10;
export const QUESTION_MAX = 500;
export const SUMMARY_MAX = 2000;
const SECTIONS = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** { ok, errors: { name?, email?, question? } } (messages are shown next to the fields). */
export function validate({ name, email, question }) {
  const errors = {};
  if (!String(name ?? "").trim()) errors.name = "Please enter your name.";
  const e = String(email ?? "").trim();
  if (!e) errors.email = "Please enter your email.";
  else if (!EMAIL.test(e)) errors.email = "That doesn't look like an email address.";
  const q = String(question ?? "").trim();
  if (q.length < QUESTION_MIN) errors.question = `Please write at least ${QUESTION_MIN} characters.`;
  else if (q.length > QUESTION_MAX) errors.question = `Please keep it under ${QUESTION_MAX} characters.`;
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Whitespace collapsed; longer than `max` is cut with "…". */
export function clip(text, max) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

const label = (id) => (id ? TREE[id].label : null);

/**
 * What the summary needs, read from the store (get(key, fallback)) through each section's own
 * restore(), so a saved state from an older version can't break the email.
 */
export function collect(get) {
  const done = get("hw:done", []);
  const tutorRaw = get(T.STORE_KEY, null);
  const labRaw = get(L.STORE_KEY, null);
  let tutor = null;
  if (tutorRaw) {
    const s = T.restore(tutorRaw, () => "x");
    if (s.mode) {
      tutor = {
        mode: s.mode,
        forks: FORKS.map((f) => {
          const fs = s.forks[f.id];
          return { id: f.id, section: f.section, pick: label(fs.pick), paper: label(f.congaPick), properties: [...fs.properties] };
        }),
      };
    }
  }
  let lab = null;
  if (labRaw) {
    const s = L.restore(labRaw);
    const R = L.results(s, "fig2");
    lab = {
      fig2: ["ecmp", "localOnly", "conga"].map((k) => ({
        label: L.SCHEME_LABEL[k],
        predicted: Number.isFinite(s.predictions.fig2?.[k]) ? s.predictions.fig2[k] : null,
        result: s.revealed.fig2?.[k] ? Math.round(R[k].total * 10) / 10 : null,
      })),
      fig2Why: s.answers.fig2Why ?? "",
      whyNot: s.answers.whyNot ?? "",
    };
  }
  return {
    done: Array.isArray(done) ? done.length : 0,
    total: SECTIONS,
    seconds: Number(get("hw:time", 0)) || 0,
    tutor,
    lab,
    questions: null, // step 09 (the partner's): add its score here once it exists
  };
}

/** Plain text, at most SUMMARY_MAX characters; long answers are cut with "…". */
export function buildSummary(d) {
  const lines = [`Sections done: ${d.done}/${d.total} · active time: ${Math.floor((d.seconds ?? 0) / 60)} min`, ""];
  if (!d.tutor) lines.push("Path to CONGA: not started");
  else {
    lines.push(`Path to CONGA (${d.tutor.mode === "live" ? "with the tutor" : "guided mode"}):`);
    for (const f of d.tutor.forks) {
      lines.push(f.pick
        ? `- ${f.id} (${f.section}): ${f.pick} (paper: ${f.paper})${f.properties.length ? ` · ${f.properties.join(", ")}` : ""}`
        : `- ${f.id} (${f.section}): not reached`);
    }
  }
  lines.push("");
  if (!d.lab) lines.push("Lab: not started");
  else {
    lines.push("Lab, Figure 2 (prediction vs result, Gbps):");
    for (const r of d.lab.fig2) lines.push(`- ${r.label}: you ${r.predicted ?? "–"}, result ${r.result ?? "–"}`);
    lines.push(`Why is local only worse? ${clip(d.lab.fig2Why, 450) || "–"}`);
    lines.push(`Why not? ${clip(d.lab.whyNot, 450) || "–"}`);
  }
  if (d.questions) lines.push("", `Questions: ${d.questions.firstTry}/${d.questions.total} right on the first try`);
  const text = lines.join("\n");
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1)}…`;
}

/** The JSON body for Web3Forms. Reply-To = the student's email, so Leon can just hit Reply. */
export function payload({ key, name, email, question, summary }) {
  const n = String(name ?? "").trim();
  const e = String(email ?? "").trim();
  return {
    access_key: key ?? "",
    subject: `CONGA homework: ${n}`,
    from_name: "CONGA homework site",
    name: n,
    email: e,
    replyto: e,
    question: String(question ?? "").trim(),
    summary: summary ?? "",
    botcheck: false,
  };
}

/** One POST, no retries. Always resolves to { ok, message }. */
export async function send(body, fetchFn = globalThis.fetch) {
  if (!body.access_key) return { ok: false, message: "Sending is not set up yet (no Web3Forms key). Your text is kept; tell the course staff." };
  if (body.botcheck) return { ok: false, message: "Not sent." }; // honeypot filled: a bot
  let res;
  try {
    res = await fetchFn(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, message: "We couldn't reach the email service. Check your connection and press Send again; your text is kept." };
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  const msg = json?.body?.message ?? json?.message ?? json?.error ?? null;
  if (res.ok && json?.success) return { ok: true, message: msg ?? "Sent." };
  return { ok: false, message: msg ?? `The email service answered ${res.status}. Your text is kept; try again later.` };
}
