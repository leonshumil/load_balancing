# CONGA homework · Unit 5, Load Balancing

**Data Center Networks & AI (361.2.2460), BGU · Semester A 2026**

A ~55-minute homework that students do alone before class. It's about **CONGA** (Alizadeh et al., *Distributed Congestion-Aware Load Balancing for Datacenters*, SIGCOMM 2014). It picks up where Unit 4 stopped (WCMP, FlowBender) and asks the same question: **who measures, who decides, who acts, and with what information?**

| | |
|---|---|
| **Live** (`main`) | https://leonshumil.github.io/load_balancing/hw/ |
| **Preview** (`dev`) | https://leonshumil.github.io/load_balancing/preview/hw/ |

The footer of every page shows which build you are looking at, e.g. `Build main · 63cb71e · 2026-11-28 11:00 UTC`.

---

## What students do

| # | Section | Time | What it is |
|---|---|---|---|
| 1 | **Read** | 7 min | Six highlighted passages from the paper, including §2.1's five design properties **P1–P5**. Click a card to zoom it; tick *Mark as read*. |
| 2 | **Watch** | 5 min | A short NotebookLM video overview. Its audio is in Hebrew on purpose: it's the one exception to "English only". |
| 3 | **Path to CONGA** | 20 min | Figure 1, fork by fork. An AI tutor asks the student to pick a branch at each fork and argue for it with P1–P5, next to a live tree. If the tutor is off or fails, a guided mode takes over. |
| 4 | **Asymmetry lab** | 15 min | Four steps with predictions first: **Figure 2** (local-only loses to ECMP), **Figure 3** (static weights = WCMP can't fit two traffic matrices), **ECMP wins?** (Figure 17's Nash flow, plus stale feedback, beyond the paper), **Why not**. A **Sandbox** lets students edit any link or demand. |
| 5 | **Questions** | 8 min | Self-check questions with instant feedback *(coming soon)*. |
| | **Submit** | | Name, email and a question for the class, emailed to the course staff with a short summary of the student's homework. |

Everything a student does is saved in their browser, so a reload loses nothing.

## How it's built

- **No framework, no build step.** Plain HTML, CSS and ES modules. Shared code and the design tokens (dark dashboard, one violet and one gold accent) are in `site/public/shared/`. The homework is in `site/public/hw/`.
- **Pure logic, tested.** Each part has a DOM-free `model.js`/`state.js` with `node:test` tests next to it. Numbers come from the paper, never from memory, and tests name their source (e.g. `CONGA §2.4, Fig 2`).
- **The lab** is a small fluid model of a leaf-spine fabric with per-flow TCP fairness. It reproduces the paper's Figure 2 numbers (ECMP 90, local only 80, CONGA 100).
- **The tutor** is a Supabase Edge Function (`supabase/functions/tutor/`, Deno). It calls an LLM through Groq, answers from retrieved paper passages, and keeps the answer key in code. The model never decides a reveal or a score.
- **Submit** posts to [Web3Forms](https://web3forms.com). Its access key is public by design.
- **Deploys.** `.github/workflows/pages.yml` publishes `site/public/` to GitHub Pages: `main` at `/`, `dev` at `/preview/`. `tools/stamp-build.sh` writes the build stamp and adds `?v=<commit>` to every script and stylesheet, so nobody gets a stale cached page.

```
site/public/
├── hw/            the homework page: index.html, hw.css, main.js
│   └── js/        sections/ · path/ · tutor/ · lab/ · submit/   (model + view + tests)
└── shared/        tokens.css · base.css · ui.css · store.js · progress.js · ui.js · config.js
supabase/          the tutor's edge function, migrations and rollbacks
tools/             build stamp, tutor dev server and smoke test, paper chunking
```

## Run it locally

The pages use ES modules, so serve them over HTTP:

```sh
python3 -m http.server 8000 -d site/public     # or: npx serve site/public
```

Open http://localhost:8000/ (it goes straight to `/hw/`). Desktop browsers only, at 1280px wide or more.

```sh
node --test tools site/public                  # all tests
```

## Working together

Two of us build this. The code is in this public repo. The step specs, notes and papers are in a private repo, `leonshumil/load_balancing-docs`, which you clone into `docs/` (this repo ignores it).

```sh
git clone https://github.com/leonshumil/load_balancing.git && cd load_balancing
git checkout dev
git clone https://github.com/leonshumil/load_balancing-docs.git docs
```

`CLAUDE.md` points Claude Code at `docs/claude/`. Name the step file you want built, e.g. `docs/claude/07-submit-results.md`.

Each piece of work follows `docs/claude/git-safety.md`:

1. Pull `dev`, push a safety tag `safe/pre-<step>-<date>`, and branch `feat/<step>`.
2. Make small commits, with tests first, and push the branch.
3. After review, merge into `dev` with `--no-ff`. The preview updates in about a minute.
4. When we both agree, merge `dev` into `main`, which is the live site.

To undo, use `git revert` (never force-push or reset `dev`/`main`). For a whole merge: `git revert -m 1 <merge-sha>`.
