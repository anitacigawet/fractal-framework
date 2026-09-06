# Fractal Framework repository instructions

These instructions apply to the entire repository.

## Read first

Before analyzing or changing code, read these files in order:

1. `START_HERE.md`
2. `README.md`
3. `docs/fractal_framework_methodology_guide.md`
4. `docs/activism_vacuum_methodology.md`
5. `docs/master_template_structure.md` when changing research, campaign, or generated-site behavior
6. The relevant prompt files under `engine/notebooklm_bridge/queries/` when changing research or citation behavior

Do not treat old chat summaries, generated output, ignored local state, or a
separate portfolio checkout as authority for this repository.

## Product boundary

- This is the lean public source distribution of the local Fractal Framework
  browser wizard.
- The supported product surface is the wizard. Do not restore a legacy CLI,
  operator console, development-history files, or unrelated portfolio tooling.
- The complete end-to-end path is **Pick for me**. The manual intake path can
  lock a campaign but does not create its NotebookLM notebook, so it cannot yet
  enter production. Do not describe that path as complete unless the code is
  changed and verified.
- Showroom mode is a deterministic browser-side demonstration. It is not a live
  research run and must not silently call external services.
- Keep the repository release-focused. Do not commit build output, installed
  dependencies, local databases, credentials, bridge output, assistant state,
  or private history.

## Non-negotiable invariants

- Keep the server bound to `127.0.0.1`. Preserve its Host/Origin checks and
  JSON-only mutation transport. There is no multi-user account authentication.
- Never read, print, commit, or overwrite `wizard/.env`, `wizard/data/`,
  `engine/notebooklm_bridge/.budget.json`,
  `engine/notebooklm_bridge/outputs/`, or external NotebookLM login state unless
  the user explicitly places that local state in scope.
- Preserve the human review-and-lock step before a proposed issue becomes a
  campaign.
- Preserve hash citation tokens on factual claims. If a citation cannot be
  resolved, keep it visibly unresolved; never invent a source URL or silently
  remove the token.
- Preserve Stitch token validation. Visual-generation passes must not rewrite,
  summarize, or drop campaign content or citations.
- Keep normal and showroom behavior separate. Both builds write to
  `wizard/dist/client`; after `pnpm build:showroom`, run `pnpm build` again before
  starting the normal wizard.
- Treat the sql.js database as single-user and single-process. Do not run two
  servers against the same `wizard.db`.
- Run the server from `wizard/`, or explicitly use absolute `DATABASE_PATH` and
  `SETTINGS_PATH` values. Their defaults are relative to the process working
  directory.
- Methodology documents are runtime inputs. Restart the server after changing
  them, and rebuild the Framework Notebook before expecting the **Pick for me**
  path to use revised cloud copies.

## Change discipline

- Inspect Git status before editing and preserve unrelated user changes.
- Use the command-scoped ownership override when Git requires it:
  `git -c safe.directory=C:/Users/james/Desktop/Project/portfilio/fractal-framework-public ...`
- Do not push, publish a release, deploy, rewrite history, or change external
  accounts and services without explicit user authorization.
- Do not run provider validation, NotebookLM login, live research, production,
  or Stitch generation merely as a test. Those commands make external calls and
  may create remote artifacts.
- When an output shape changes, update the associated prompt, parser, shared
  type, default renderer, Stitch scaffold/injection path, and showroom fixture
  together.
- Keep `README.md` for users. Put maintenance state and AI orientation in
  `START_HERE.md` instead of expanding the public introduction.

## Verification

Use the smallest relevant set, then run the full inert gate before declaring a
repository-wide change ready:

```powershell
Set-Location wizard
pnpm check
pnpm test
pnpm build
pnpm build:showroom
pnpm build

Set-Location ..\engine
python -B -m unittest discover -s tests -p "test_*.py" -v
python -m notebooklm_bridge.runner --help

Set-Location ..
.\Launch_Wizard.bat /verify
```

The second normal build is intentional. `pnpm audit` is part of CI but
requires registry access. Full workflow verification requires the user's own
credentials and explicit authorization for external calls.
