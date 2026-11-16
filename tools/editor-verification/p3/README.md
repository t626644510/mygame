# P3 independent verification

This directory and `docs/editor/P3_VERIFICATION.md` belong to the independent
verifier. Backend, frontend, new Game pathfinding/tests, original inputs and Git
remain with their respective owners. Evidence is saved under
`outputs/helper_editor_p3/verification/`; isolated content and build output go to
`work/p3_verification_20261117/`. Old verification tools are read-only dependencies.

`first-meal-check.mjs --dotnet <absolute SDK executable> --output <fresh evidence>
--work <fresh work>` compiles the real existing BaseSession, BaseScenario,
BaseSnapshot and existing UnityJson reader. It invokes the old first-meal state
machine for the original near/far positions and preserves raw input, ledger,
snapshots, build streams and source hashes. SDK 8.0.428 is required. Build bin/obj
are isolated; no product CLI, Unity or browser is launched. Passing this check
supports only the old-kernel half of D2, never P3 import/distance or Unity.

D1 uses the frozen Base specialist's actual pathfinding raw output and the
separately authorized Unity batch, never another BFS implementation. The recorded
P3 batch completed 84 tests. Its Editor exit0, launcher exit3 and native
ReviewRequired are separate outcomes. `Run-P3UnityTests.ps1` defaults to read-only
preflight; an old source-approval flag is not permission for another `-Execute`.
Every future execution needs fresh source review, actor/resource acknowledgments
and an explicit root instruction. Do not use the ordinary Player to reproduce
the existing native exit issue.

Layout geometry errors may be saved for design iteration, but active invalid
layouts block export. All five chain flags are analysis warnings, never export
blockers on their own. Missing IDs, invalid fields and active dependencies on
unsupported drafts retain the existing hard export gate. Static design data
does not imply runtime building/recipe integration.

`backend-checks.mjs` follows the P3 contract and must only be invoked
after the backend owner provides a ready immutable DLL. Options are `--dotnet`,
`--cli`, `--expected-cli-sha`, `--contract-sha`, `--first-meal-baseline`, `--output`,
`--work`, and, on Windows, `--pwsh`; `--build-receipt` is recorded when supplied.
It owns only port 5186 and a retained backend process, with exact-PID metadata
before stopping. It checks CLI import/HTTP distance, active invalid layouts,
rotation, the five nonblocking chain flags, deterministic four-file export and
failure no-write gates. Source, DLL, raw HTTP and whole-directory byte records
remain separate from browser/Unity claims. A prepared script or passing syntax
check is not a product result.
`--only D3,D8` (or another listed subset) limits follow-up criteria after an
actual fix. A fresh import used only to seed prerequisites is not labeled a new
D2 result. Failed runs and their directory no-write assertions remain intact.
`--d3-codes unreachable,ownership_not_allowed` limits a D3 follow-up to those
unfinished geometry cases. Both instance and spawn issue locations are checked
against their actual JSON pointer and integer grid coordinates. Every new pure
or rejected-operation guard saves complete before/after path/byte/SHA manifests.

The portable CI subset is `first-meal-check.mjs`, then `backend-checks.mjs` with
`--only D2,D3,D4,D5,D8` and `--first-meal-baseline` pointing to that same checkout's
new `FIRST_MEAL_BASELINE.json`. Do not substitute a historical Windows input hash
or ledger on macOS. Run each job in its own checkout with fresh output/work
children; port 5186 is exclusive within that job. Windows requires an absolute
PowerShell7 executable via `--pwsh`; POSIX uses `/bin/ps` and the retained child
handle. The P3 macOS path remains unverified until actual remote CI completes.
These scripts require no Playwright or Unity. Their read-only dependencies are
`../raw-evidence.mjs`, `../owned-process.ps1` (Windows), and
`../p2/http-context.mjs` (method-aware persistence classification); the oracle
also compiles the original three Base Runtime sources and `UnityJson.cs`.

`backend-boundaries.mjs` uses the same service options and supports
`--only aliases,etag,refs,schema,distance,pending`; it records the targeted shared
CRUD/schema/distance/pending checks separately from the main D matrix.
`browser-checks.mjs` additionally requires `--pwsh`, `--browser-exe`,
`--frontend-manifest` and the existing editor-web Playwright/Vite installation.
It owns ports5176/5186 and isolated
profile/content roots, and supports `--only D6,D5,F03,D3,D4-ui`. It operates real
DOM/pointer/keyboard controls and only reads the actually loaded production store
module for state snapshots. It does not mutate that store to simulate actions.
This Windows browser path is outside portable CI; it is not a D7 performance or
D9 screenshot runner.

Every process stop uses the retained owned child and its current exact-PID
identity. Never stop a process by a stale PID or port. Full source copies, raw
streams/bodies, trace and no-write manifests belong in ignored `outputs`/`work`,
not public source. Original failed results are retained; a correction or offline
adjudication never rewrites a false result to true. Current actual evidence,
version inheritance, known diagnostic boundaries and root decisions are in
`docs/editor/P3_VERIFICATION.md`. User-review fixtures are prepared by the separate
backend-owned `tools/sim-cli/scripts/prepare-p3-review.mjs`; these acceptance
fixtures are disposable and are not a prepare-only workflow.
