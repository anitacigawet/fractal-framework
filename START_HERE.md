# Start here: Fractal Framework

This is the repository handoff and maintenance entrypoint. `README.md` explains
the project to users; this file tells a new developer or AI how to work on it
without reconstructing the repository from chat history.

## Current baseline

- Public release: `v1.1.0`
- Published baseline commit: `789a383a136fc0b0aecd0770af8dcf9bf868b3b5`
- Supported product: the local browser wizard only
- Runtime shape: one loopback-only Node process plus a Python NotebookLM bridge
- License: PolyForm Noncommercial 1.0.0
- Active implementation task: none recorded in this repository

The public release was deliberately reduced to a lean source distribution. Do
not infer that removed development tools, operator interfaces, old templates,
or repository history should be restored.

## Read in this order

1. `AGENTS.md` for repository boundaries and validation rules.
2. `README.md` for the user-facing product and supported setup path.
3. `docs/fractal_framework_methodology_guide.md` for the general method.
4. `docs/activism_vacuum_methodology.md` for issue-selection criteria.
5. `docs/master_template_structure.md` for the campaign structure.
6. `engine/notebooklm_bridge/queries/` for the executable research personas and
   six production prompts.
7. The code areas listed below for the task actually being changed.

## System map

| Area | Primary files | Responsibility |
| --- | --- | --- |
| Browser client | `wizard/client/src/` | Location intake, review, campaign progress, preview, download, and settings UI |
| Local API | `wizard/server/_core/index.ts`, `wizard/server/routers/` | Express/tRPC API, background workflow orchestration, and HTML download |
| Persistence | `wizard/server/_core/db.ts`, `campaignRepo.ts`, `frameworkRepo.ts`, `productionRepo.ts`, `stitchRepo.ts` | Single-process sql.js database stored locally |
| Research bridge | `engine/notebooklm_bridge/` | NotebookLM login adapter, notebook/source operations, research, and prompt execution |
| Editorial rules | `docs/`, `engine/notebooklm_bridge/queries/` | Methodology, issue selection, source tiers, refusal rules, and required output shapes |
| Site generation | `siteTemplate.ts`, `siteScaffold.ts`, `stitch.ts` | Default HTML, Stitch scaffold/token validation, and content injection |
| Release gates | `Launch_Wizard.bat`, `.github/workflows/check.yml` | Windows verification/launch and CI checks |

## End-to-end workflow

1. A user enters a location in **Pick for me**.
2. The bridge uses the Framework Notebook methodology to form a research query.
3. It creates a fresh NotebookLM notebook, runs web research, imports sources,
   and proposes one neglected local issue.
4. The user reviews and edits the proposal before locking a campaign.
5. Production applies the Trust Server persona and runs six file-backed prompts:
   metadata, hero, about, key facts, what is at stake, and how to help.
6. Citation tokens are matched to the notebook's source list when possible.
   Unresolved tokens remain visible.
7. The default renderer produces the site. Optional Stitch design runs through
   a token-preservation gate before content is injected.
8. The user downloads the result as one HTML file.

## Local state and external effects

The application may store API keys in plaintext in ignored
`wizard/data/settings.json`. Campaigns and job state live in ignored
`wizard/data/wizard.db`. Environment variables override saved settings. Never
commit or quote either file.

NotebookLM research and login, LLM provider checks, and Stitch generation are
real external operations. They may consume quotas and create cloud notebooks,
projects, or screens. Keep ordinary code verification inert unless the user
explicitly authorizes a live workflow test.

The server API has no authentication and is safe only under its current
`127.0.0.1` binding. Do not expose it through a public bind, proxy, or tunnel
without first adding an authentication and authorization design.

## Setup and normal run

Use Node.js 22+, pnpm 10.33.2, and a stable Python 3.11+ interpreter. The
clean-room-verified release path is Windows. The Node and Python components are
portable, but this repository does not include a macOS/Linux launcher.

Use the full frozen Node install; `pnpm start` runs `tsx`, which is currently a
development dependency.

```powershell
Set-Location wizard
pnpm install --frozen-lockfile

Set-Location ..\engine\notebooklm_bridge
python -m pip install -r requirements.txt
python -m playwright install chromium
notebooklm login

Set-Location ..\..\wizard
Copy-Item .env.example .env
pnpm build
pnpm start
```

Open `http://127.0.0.1:7101`. On Windows, after installing the Python
requirements and completing NotebookLM login, `Launch_Wizard.bat` performs the
locked Node install, bridge verification, normal build, and launch. Set
`BRIDGE_PYTHON` to an explicit stable interpreter when more than one Python is
installed.

## Inert verification gate

These checks do not intentionally run research or provider generation:

```powershell
Set-Location wizard
pnpm check
pnpm build
pnpm build:showroom
pnpm build

Set-Location ..\engine
python -c "import notebooklm_bridge; print(notebooklm_bridge.__version__)"
python -m notebooklm_bridge.runner --help

Set-Location ..
.\Launch_Wizard.bat /verify
```

CI additionally starts the already-built production server, checks
`/api/health` and the home page, and runs `pnpm audit --prod`. The dependency
audit needs network access. CI also expects `runner status --force` to exit 1
when NotebookLM authentication is unavailable; that is not a build failure.

## Known constraints to preserve or address explicitly

- **Pick for me is the complete path.** Manual intake currently locks a
  campaign without creating a notebook, so production rejects it.
- **Background work is process-local.** Restarting the server can leave a
  framework, production, or Stitch row stranded in an in-progress state.
- **The database is single-process.** Every write exports the full in-memory
  sql.js database back to disk.
- **Build modes share an output directory.** A showroom build can replace the
  normal client until `pnpm build` runs again.
- **Methodology is cached.** Manual intake needs a server restart after local
  methodology changes; **Pick for me** also needs a rebuilt Framework Notebook.
- **Generated pages are not fully offline.** The one-file output loads Tailwind
  and fonts from CDNs when opened.
- **There is no repository-owned unit-test suite.** The current gate is
  type-checking, builds, Python import/CLI checks, a local server smoke test, and
  dependency audit.
- **Treat generated design HTML as active content.** Stitch previews currently
  use an unsandboxed same-origin `srcDoc` iframe.
- **Do not rely on the Stitch privacy comment as a contract.** The current
  design prompt includes campaign identifiers and short copy before long-form
  content is injected locally.
- **A bridge health warning can be misleading.** The Settings check looks for
  `Auth: ok`, while the Python status command reports `Auth: valid`.

## Starting a new task

Before editing:

1. Run the command-scoped Git status check from `AGENTS.md`.
2. State the requested change and the files likely to be affected.
3. Decide whether the task needs only inert checks or an explicitly authorized
   live external workflow.
4. Keep ignored local state and unrelated changes untouched.
5. Record any new durable limitation or changed command in this file.

## Copy-paste bootstrap for another AI

```text
Work only inside this Fractal Framework repository. This is the lean public
source distribution for a local browser wizard, not the original development
workspace.

Before responding, read AGENTS.md, START_HERE.md, and README.md in full. Then
read the three documents under docs/ in the order listed by START_HERE.md. If
the request affects research, citations, or generated site content, also read
the relevant files under engine/notebooklm_bridge/queries/ and trace the
matching router, parser, renderer, Stitch path, shared types, and showroom
fixture before proposing edits.

Treat the supported product boundary as the wizard only. Keep the server on
127.0.0.1, preserve the human review-and-lock step, preserve visible hash
citations and unresolved tokens, and keep the Stitch citation/token validation
gate. Do not restore removed CLIs, operator consoles, development history, or
unrelated portfolio files.

Do not inspect, print, replace, or commit ignored credentials or runtime state.
Do not run NotebookLM login, provider validation, live research, production, or
Stitch generation without explicit permission because those actions contact
external services and can create remote artifacts. Do not push, release,
deploy, or rewrite Git history unless explicitly asked.

First report the current branch, HEAD, dirty state, the exact task you believe
is in scope, and any relevant known constraint from START_HERE.md. If no task
was supplied, ask what should be changed. After changes, run the smallest
relevant checks and the inert repository gate in AGENTS.md. Distinguish what
was verified locally from what would still require credentials or a live
external-service test.
```
