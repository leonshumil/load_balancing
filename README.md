# CONGA homework, Unit 5 (Load Balancing)

The homework website for course 361.2.2460, Data Center Networks & AI (BGU), Unit 5 on CONGA
(Alizadeh et al., SIGCOMM 2014). Students do it alone before class (about 60 minutes): read,
watch, walk the paper's Figure 1 design tree, try a small lab on Figures 2 and 3, and answer
self-check questions. Their answers feed the class discussion. It is a static site (plain HTML,
CSS and ES modules, no build step) in `site/public/hw/`, with shared styles and scripts in
`site/public/shared/`; the site root redirects to the homework. `.github/workflows/pages.yml`
publishes `site/public/` to GitHub Pages: `main` is live at `/`, and `dev` is always at `/preview/`
(https://leonshumil.github.io/load_balancing/preview/).

## Run locally

The pages use ES modules, so serve them over HTTP instead of opening the files directly:

```sh
npx serve site/public
# or, without Node: python3 -m http.server 8000 -d site/public
```

Then open the printed address (http://localhost:3000 for `serve`, http://localhost:8000 for Python).
The root address opens the homework (`/hw/`).

Tests (from the first model step on): `node --test site/public`.

## Working together

Two of us work on this. The code is in this (public) repo; the step specs, notes and papers are
in a **private** repo, `leonshumil/load_balancing-docs`, that you clone into `docs/` (this repo
ignores `docs/`). You need to be a collaborator on both repos.

First time:

```sh
git clone https://github.com/leonshumil/load_balancing.git
cd load_balancing
git checkout dev
git clone https://github.com/leonshumil/load_balancing-docs.git docs
```

`CLAUDE.md` is committed here and points Claude Code at `docs/claude/`, so both of us work from
the same specs: tell Claude which step file to do (e.g. `docs/claude/05-lab-model.md`).

Day to day, both of us commit to `dev` (never to `main`):

```sh
git pull --rebase            # get the other person's work first
# ... work, test locally, commit ...
git pull --rebase && git push
(cd docs && git pull --rebase)   # and push there too when a spec or note changes
```

Each push to `dev` updates the shared preview in about a minute. Keep commits small and stick to
your own step's files to avoid conflicts. `main` (the live site) is only updated by merging
`dev` once we both agree it's ready.
