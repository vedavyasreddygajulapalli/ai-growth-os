# Crawl Lab test website

Public static test property for AI Growth OS crawler acceptance checks. It has no sign-up form and stores no visitor data.

## Expected tests

- Sitemap index resolves two nested sitemaps; sitemap entries include ordinary, sitemap-only, noindex, robots-blocked, and missing URLs.
- robots.txt allows public content and disallows `/private-lab/`.
- `/services/` duplicates the About page title, omits its meta description, and has an image without alt text.
- `/broken-link/` returns 404; `/sitemap-missing-page/` is a sitemap URL returning 404.
- Render Blueprint redirects `/legacy-services` to services, provides a two-hop redirect chain, and includes a loop pair to test redirect-limit safety.
- `/noindex-preview/` is discoverable but marked noindex.
- `/sitemap-only/` is in the sitemap and has no inbound internal links.
- `/insights/site-structure/` includes canonical, Open Graph, Article JSON-LD, headings, and internal links.
- `example.invalid` is reserved for external-link failure handling.

After the Blueprint creates the static site, confirm its assigned onrender.com host. If it differs from `ai-growth-os-crawler-test.onrender.com`, update that hostname in canonical tags, sitemap files, and robots.txt before crawling.
