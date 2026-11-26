# CONGA homework, Unit 5 (Load Balancing)

The homework website for course 361.2.2460, Data Center Networks & AI (BGU), Unit 5 on CONGA
(Alizadeh et al., SIGCOMM 2014). Students do it alone before class (about 60 minutes): read,
watch, walk the paper's Figure 1 design tree, try a small lab on Figures 2 and 3, and answer
self-check questions. Their answers feed the class discussion. It is a static site (plain HTML,
CSS and ES modules, no build step) in `site/public/hw/`, with shared styles and scripts in
`site/public/shared/`; the site root redirects to the homework. `.github/workflows/pages.yml`
publishes `site/public/` to GitHub Pages: `main` is live at `/`, the pushed branch goes under
`/preview/`.

## Run locally

The pages use ES modules, so serve them over HTTP instead of opening the files directly:

```sh
npx serve site/public
# or, without Node: python3 -m http.server 8000 -d site/public
```

Then open the printed address (http://localhost:3000 for `serve`, http://localhost:8000 for Python).
The root address opens the homework (`/hw/`).

Tests (from the first model step on): `node --test site/public`.
