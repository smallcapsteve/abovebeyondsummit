# Above & Beyond Summit — Website

Static site for the Above & Beyond Mining Summit.
**November 22–24 · The Scott Resort & Spa · Scottsdale, Arizona · Presented by The Deep Dive**

## Pages

- `index.html` — landing page (hero, highlights, agenda, venue, registration CTAs)
- `register-company.html` — company registration form
- `register-investor.html` — investor registration form

## Current status: local mockup

- Forms validate and show a confirmation message but **do not submit anywhere yet**. Wire the submit handlers (bottom of each register-*.html) to a backend or service (Formspree, a small API on the droplet, etc.) before launch.
- Venue photos are styled placeholders. Save images from thescottresort.com into `assets/` and swap each `<figure class="photo">…</figure>` for `<figure class="photo"><img src="assets/your-photo.jpg" alt="…"></figure>`.
- The A&B logo is an SVG recreation (`assets/logo.svg`, `assets/mark.svg`). Replace with the official PNG by dropping it in `assets/` and updating the hero `<img>` in `index.html`.
- The Deep Dive logo is hotlinked from thedeepdive.ca — consider downloading a copy into `assets/` before deploying.

## Preview locally

Open `index.html` in a browser, or:

```bash
cd above-beyond-summit
python3 -m http.server 8000
# → http://localhost:8000
```

## Deploy (planned)

1. Push this folder to a GitHub repo.
2. On the DigitalOcean droplet: clone the repo and serve with nginx (root pointed at the repo folder).
3. Point the Cloudflare domain's DNS A record at the droplet IP; enable Cloudflare SSL (Full).
