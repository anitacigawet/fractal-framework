---
phase: C (wizard production)
query_id: 01_meta
status: production
last_edited: 2026-08-31
description: Page metadata for the campaign's single-page advocacy site — title, meta description, three SEO keywords, and a breaking-news banner. Parameterized by Campaign fields ([PROJECT_NAME], [PROJECT_MISSION], [LOCALE]).
---

# Site Metadata

## Instructions (sent to Chat)

I am building a single-page advocacy website for the campaign **[PROJECT_NAME]**, addressing this mission: *[PROJECT_MISSION]*. The site targets residents and policymakers in [LOCALE].

Based on the sources in this notebook, please produce, IN ORDER:

1. **Page title** — a high-impact title for the site, maximum 60 characters. Plain text, no quotes.
2. **Meta description** — one to two sentences (160 chars max) summarizing the core vacuum and what's at stake. Include the locale.
3. **Three SEO keywords** — beyond common ones; specific to this issue and locale. Comma-separated.
4. **Breaking-news banner** — one sentence flagging the most recent material development on this vacuum (a regulatory event, court ruling, pending bill, etc.), with a hash citation to the source. If no recent development is supported by the sources, refuse cleanly per the persona protocol.

Number each output. Include hash citations on factual claims per the persona discipline. No preamble.
