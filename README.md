# CONGA homework (Unit 5, Load Balancing)

A one-page interactive homework for course 361.2.2460, Data Center Networks & AI (BGU): students
work through three short puzzles on CONGA (Alizadeh et al., SIGCOMM 2014) and answer three
questions before class, and the results feed the class discussion. It is a static site (plain
HTML, CSS and ES modules, no build step) in `site/public/`, published to GitHub Pages by
`.github/workflows/pages.yml`: `main` is live at `/`, the pushed branch goes under `/preview/`.

## Run locally

The page uses ES modules, so serve it over HTTP rather than opening the file directly:

```sh
python3 -m http.server 8000 -d site/public
# or: npx serve site/public
```

Then open http://localhost:8000. Tests (from step 02 on): `node --test site/public/js`.
