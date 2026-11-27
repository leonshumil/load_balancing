// Questions (step 09): pure checking and bookkeeping. No DOM.
// A question: { id, type, prompt, options?, answer, tolerance?, unit?, explanation, source, section, anchor? }
//   mc:      answer = option id;           a student's answer = option id
//   multi:   answer = [option ids] (a set); a student's answer = [option ids]
//   numeric: answer = number (± tolerance); a student's answer = number or numeric string
//   order:   answer = [option ids] in order; options are listed in the order shown at first
// Self-check: answers may show right away (REVEAL_AT does not apply).

const TYPES = ["mc", "multi", "numeric", "order"];
const optionIds = (q) => (q.options ?? []).map((o) => o.id);
const toNumber = (a) => (typeof a === "number" ? a : typeof a === "string" && a.trim() !== "" ? Number(a.trim()) : NaN);
const uniq = (a) => [...new Set(a)];

/** Is there something to check? */
export function answered(q, a) {
  const ids = optionIds(q);
  switch (q.type) {
    case "mc": return ids.includes(a);
    case "multi": return Array.isArray(a) && a.some((x) => ids.includes(x));
    case "numeric": return Number.isFinite(toNumber(a));
    case "order": return Array.isArray(a) && a.length === ids.length && ids.every((x) => a.includes(x));
    default: return false;
  }
}

/** { correct, feedback }: feedback is one short line; the explanation is shown separately. */
export function check(q, a) {
  if (!answered(q, a)) return { correct: false, feedback: "Answer first, then check." };
  const wrong = (feedback) => ({ correct: false, feedback });
  const right = { correct: true, feedback: "Right." };
  switch (q.type) {
    case "mc":
      return a === q.answer ? right : wrong("Not quite. Try again.");
    case "multi": {
      const picked = uniq(a);
      const hits = picked.filter((x) => q.answer.includes(x)).length;
      const extra = picked.length - hits;
      if (hits === q.answer.length && extra === 0) return right;
      return wrong(`${hits} of ${q.answer.length} right${extra ? `, ${extra} that ${extra === 1 ? "isn't" : "aren't"}` : ""}.`);
    }
    case "numeric": {
      const x = toNumber(a);
      const tol = q.tolerance ?? 0;
      if (Math.abs(x - q.answer) <= tol + 1e-9) return right;
      return wrong(x > q.answer ? "Too high. Try again." : "Too low. Try again.");
    }
    case "order": {
      const inPlace = a.filter((x, i) => x === q.answer[i]).length;
      if (inPlace === q.answer.length) return right;
      return wrong(`${inPlace} of ${q.answer.length} in the right place.`);
    }
  }
}

const EMPTY = { firstAnswer: null, answer: null, tries: 0, correct: false, firstCorrect: false };

/** One Check. Keeps the first answer; a correct question is not checked again. */
export function record(state, q, a) {
  const prev = state.attempts[q.id];
  if (prev?.correct || !answered(q, a)) return state;
  const { correct } = check(q, a);
  const value = Array.isArray(a) ? [...a] : q.type === "numeric" ? toNumber(a) : a;
  const next = prev
    ? { ...prev, answer: value, tries: prev.tries + 1, correct }
    : { firstAnswer: value, answer: value, tries: 1, correct, firstCorrect: correct };
  return { ...state, attempts: { ...state.attempts, [q.id]: next } };
}

/** First-try score and the questions missed on the first try (bank order). */
export function score(state, questions) {
  const at = (q) => state.attempts[q.id];
  return {
    firstTry: questions.filter((q) => at(q)?.firstCorrect).length,
    total: questions.length,
    checked: questions.filter((q) => at(q)?.tries > 0).length,
    missed: questions.filter((q) => at(q)?.tries > 0 && !at(q).firstCorrect).map((q) => q.id),
  };
}

/** Done once every question has been checked at least once. */
export const isDone = (state, questions) => questions.every((q) => state.attempts[q.id]?.tries > 0);

/** Stored state -> a safe state for this bank. */
export function cleanState(raw, questions) {
  const ids = questions.map((q) => q.id);
  const r = raw && typeof raw === "object" ? raw : {};
  const drafts = {};
  const attempts = {};
  for (const id of ids) {
    if (r.drafts && Object.hasOwn(r.drafts, id)) drafts[id] = r.drafts[id];
    const x = r.attempts?.[id];
    if (x && typeof x === "object" && Number.isInteger(x.tries) && x.tries > 0) {
      attempts[id] = { firstAnswer: x.firstAnswer ?? null, answer: x.answer ?? null, tries: x.tries, correct: !!x.correct, firstCorrect: !!x.firstCorrect };
    }
  }
  return { current: ids.includes(r.current) ? r.current : ids[0], drafts, attempts };
}

/** For step 07's Submit: every question, in bank order. */
export const submission = (state, questions) => questions.map((q) => ({ id: q.id, ...(state.attempts[q.id] ?? EMPTY) }));

/** Problems in a bank (empty = fine). */
export function validateBank(questions) {
  const errs = [];
  const seen = new Set();
  for (const q of questions) {
    const tag = q.id ?? "(no id)";
    if (!q.id || seen.has(q.id)) errs.push(`${tag}: missing or duplicate id`);
    seen.add(q.id);
    if (!TYPES.includes(q.type)) { errs.push(`${tag}: unknown type ${q.type}`); continue; }
    for (const k of ["prompt", "explanation", "source", "section"]) if (!q[k]) errs.push(`${tag}: no ${k}`);
    const ids = optionIds(q);
    if (q.type !== "numeric" && (ids.length < 2 || uniq(ids).length !== ids.length)) errs.push(`${tag}: options need 2+ unique ids`);
    if (q.type === "mc" && !ids.includes(q.answer)) errs.push(`${tag}: answer is not an option`);
    if (q.type === "multi" && !(Array.isArray(q.answer) && q.answer.length && q.answer.every((x) => ids.includes(x)))) errs.push(`${tag}: answer must be option ids`);
    if (q.type === "order" && !answered(q, q.answer)) errs.push(`${tag}: answer must order every option`);
    if (q.type === "numeric" && !(Number.isFinite(q.answer) && (q.tolerance ?? 0) >= 0 && q.unit)) errs.push(`${tag}: numeric needs answer, tolerance >= 0 and unit`);
  }
  return errs;
}
