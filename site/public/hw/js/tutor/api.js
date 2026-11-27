// Calls to the tutor function (step 11). Replies take 2-5 s; we wait up to 20 s, retry once
// on a timeout, a network error or a 5xx, and otherwise return an error kind the page acts on.

export const TIMEOUT_MS = 20_000;

/** Failures that switch the page to the guided (scripted) mode. */
export const FALLBACK_KINDS = new Set(["class_code", "quota", "limit", "unavailable", "timeout", "network"]);

async function post(url, body, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, retries = 1 } = {}) {
  let last = { ok: false, kind: "network" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      let data = null;
      try {
        data = await res.json();
      } catch { /* not JSON */ }
      if (res.ok && data) return { ok: true, data };
      if (res.status >= 500) {
        last = { ok: false, kind: "unavailable", reply: data?.reply };
        continue;
      }
      const kind = typeof data?.error === "string" ? data.error : res.status === 401 ? "class_code" : "bad_request";
      return { ok: false, kind, reply: data?.reply };
    } catch (e) {
      last = { ok: false, kind: e?.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

export const askTutor = (url, body, opts) => post(url, body, opts);

export const fetchPassage = (url, classCode, id, opts) =>
  post(url, { action: "passage", class_code: classCode, id }, opts);
