# CONGA, Unit 5 (Load Balancing)

Two small websites for course 361.2.2460, Data Center Networks & AI (BGU), Unit 5 on CONGA
(Alizadeh et al., SIGCOMM 2014). The **homework** (`site/public/hw/`, about 60 minutes) is done
alone before class: read, watch, walk the paper's Figure 1 design tree, and try a small lab on
Figures 2 and 3. Its answers feed the class discussion. The **lesson** site (`site/public/lesson/`)
is what we present in class. Both are static pages (plain HTML, CSS and ES modules, no build step)
that share their styles and scripts through `site/public/shared/`. `.github/workflows/pages.yml`
publishes `site/public/` to GitHub Pages: `main` is live at `/`, the pushed branch goes under
`/preview/`.

## Run locally

The pages use ES modules, so serve them over HTTP instead of opening the files directly:

```sh
npx serve site/public
# or, without Node: python3 -m http.server 8000 -d site/public
```

Then open the printed address (http://localhost:3000 for `serve`, http://localhost:8000 for Python).
The landing page links to `/hw/` and `/lesson/`.

Tests (from the first model step on): `node --test site/public`.
