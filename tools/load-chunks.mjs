#!/usr/bin/env node
// Upsert the paper chunks (tools/.out/chunks.json, from build-chunks.mjs) into paper_chunks.
// Uses the service key from .env (never committed):
//   SUPABASE_URL=https://<ref>.supabase.co
//   SUPABASE_SECRET_KEY=sb_secret_...        (or SUPABASE_SERVICE_ROLE_KEY=<legacy JWT>)
//
//   node tools/build-chunks.mjs && node tools/load-chunks.mjs
// Chunks that no longer exist in the file are deleted, so the table matches the file.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

const env = { ...loadEnv(resolve(root, ".env")), ...process.env };
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env");
  process.exit(1);
}

const file = process.argv[2] ?? resolve(root, "tools/.out/chunks.json");
const chunks = JSON.parse(readFileSync(file, "utf8")).map((c) => ({
  id: c.id, section: c.section, page: c.page, text: c.text, figures: c.figures ?? [], updated_at: new Date().toISOString(),
}));

// New secret keys (sb_secret_...) go in `apikey` only; legacy JWT keys also as Bearer.
const headers = { apikey: key, "Content-Type": "application/json" };
if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

const rest = `${url.replace(/\/$/, "")}/rest/v1/paper_chunks`;
const up = await fetch(`${rest}?on_conflict=id`, {
  method: "POST",
  headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(chunks),
});
if (!up.ok) {
  console.error(`upsert failed: ${up.status} ${await up.text()}`);
  process.exit(1);
}
const ids = chunks.map((c) => `"${c.id}"`).join(",");
const del = await fetch(`${rest}?id=not.in.(${encodeURIComponent(ids)})`, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } });
if (!del.ok) {
  console.error(`cleanup failed: ${del.status} ${await del.text()}`);
  process.exit(1);
}
const count = await fetch(`${rest}?select=id`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } });
console.log(`loaded ${chunks.length} chunks; table now has ${count.headers.get("content-range")?.split("/")[1] ?? "?"} rows`);
