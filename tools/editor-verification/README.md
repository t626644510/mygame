# Independent Helper editor acceptance

This directory belongs to the independent P1 verifier. It does not modify the
sim-cli or editor-web implementation, original Runtime, or original Prototype
configuration. The acceptance matrix and actual status are recorded in
[`docs/editor/P1_VERIFICATION.md`](../../docs/editor/P1_VERIFICATION.md).

`fixtures/baseline.json` freezes the five work-order items and independently read
legacy reference locations. It was not derived from product scan output. The
numbers are replaceable prototype parameters; ore 3 and sand 2 are enhancement
consumption, not the amount dropped by an encounter.

`raw-evidence.mjs` uses only Node built-ins. It runs an argument array without a
shell, concurrently collects stdout/stderr as Buffer, writes the exact bytes,
then hashes those same bytes. HTTP body bytes and response headers are retained
separately. File snapshots cover every file, including `.meta` and unrelated
sentinels, so a failed export cannot pass by checking only the expected JSON.

The collector selfcheck is safe to run independently of the product. It spawns
only Node and probes CRLF, non-UTF-8 bytes, a NUL, and Chinese text. From the
repository root, choose a **new** output directory whose parent already exists:

```powershell
node tools/editor-verification/capture-selfcheck.mjs outputs/p1_20261116/verification/capture_selfcheck_002
```

The first successful selfcheck is preserved in
`outputs/p1_20261116/verification/capture_selfcheck_001/`. It establishes only the
evidence collector's byte handling, not any P1 product acceptance item.

Product checks are added against the frozen P1 HTTP/CLI contract and run only
after the owners provide a reviewable build. Test content and runtime export
outputs stay under `work/p1_verification_20261116/`; evidence stays under
`outputs/p1_20261116/verification/`. The independent services reserve ports
5186 (backend) and 5176 (frontend), with an independent browser context/profile.
Do not stop another owner's process or share their content root.

Unity is not started by this directory's Node tooling. B8 requires separately
scheduled, controlled Unity 6000.3.28f1 batchmode/nographics execution. Never use
the ordinary Player or system UIAutomation for these checks.

## Real backend checks and CI

After the backend owner declares a specific DLL and contract ready, run
`backend-checks.mjs`. Supply absolute `--dotnet` and `--cli` paths, a new child
directory for each of `--work` and `--output`, `--port 5186`, and
`--ready-contract-sha` equal to the SHA-256 of `docs/editor/P1_API_CONTRACT.md`.
Create their parent directories first. On Windows also supply `--pwsh` with the
PowerShell 7 executable. Each CI matrix job has its own checkout and port.

The Windows service identity reader uses exact-PID native queries; it does not
depend on CIM. POSIX CI uses exact-PID `ps` parent/UID/start/image/argument reads,
checks the retained child's parent and current UID, and checks actual HTTP
content/export roots. The POSIX branch is implemented for CI and awaits the
actual matrix run; local Windows evidence does not establish macOS passage.

The one historical CRLF source has both a frozen original raw SHA and an
explicitly derived LF checkout SHA in the baseline fixture. This accommodates
the repository's JSON `eol=lf` policy. Actual source, stdout, stderr, HTTP, and
export evidence is always saved and hashed as received; evidence is never
normalized.

## Browser and Unity boundaries

`run-browser.mjs` records the complete `browser-checks.mjs` process streams as
bytes. Its required arguments are `--dotnet`, `--cli`, `--output`, `--work`,
`--pwsh`, and `--browser-exe`. It uses the installed project Playwright, an
isolated Edge context/profile/temp directory, a unique ignored Vite cache below
the real editor's node_modules, and ports 5176/5186. It does not override
server.fs.allow. `--only B9,B10` can select a related rerun; unselected
items remain NotRun. No store method or mocked response substitutes for UI
actions. The batch race check delays one real request, then continues it to the
actual server.

A resolved `document.fonts.ready` alone is never treated as font loading
success: B11 also requires each declared Noto Face to have status loaded.

`Run-P1UnityItemCheck.ps1` defaults to recording a plan. Only the separately
scheduled `-Execute` command starts one Editor batch. It records identity and
resource limits, preserves original process streams, and checks final tail
diagnostics before acceptance. `ReviewRequired` exit 3 requires root review and
never launches a subsequent Unity batch. `compare-unity-readback.mjs` compares
every exported key/value/array with the real readback and source projection.
The scheduled B8 launcher reads the actual Game five-item export and independent
nine-item probe in one Editor process; `compare-dual-unity.mjs` verifies both
complete cases and the exact-source/ID bridge between the formal five items and
probe subset. Field-data passage does not clear native tail diagnostic review.
