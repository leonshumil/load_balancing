// Site configuration, shared by both sites. Public values only: no keys or secrets here.

/** Switch the AI tutor off (the Figure 1 section then runs in guided mode only). */
export const TUTOR_ENABLED = true;

/** The tutor edge function (step 11), deployed on Supabase. */
export const TUTOR_URL = "https://qbrzalgcfweokxnsqduk.supabase.co/functions/v1/tutor";

/** Local development: tools/tutor-dev.sh. The deployed function refuses localhost origins. */
export const TUTOR_URL_LOCAL = "http://localhost:8787";

/** The URL this page should use: local when the page itself is served from localhost. */
export function tutorUrl(hostname = globalThis.location?.hostname ?? "") {
  return /^(localhost|127\.0\.0\.1)$/.test(hostname) ? TUTOR_URL_LOCAL : TUTOR_URL;
}
