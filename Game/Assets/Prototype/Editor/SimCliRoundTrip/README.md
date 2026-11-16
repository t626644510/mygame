# P0-C: Unity JSON roundtrip check

This independent Editor-only assembly implements acceptance item A6. It references
`Prototype.Combat` and does not change existing Runtime, Editor, scene, Player,
configuration or report files. Passing it does not establish that the recorded
ordinary Player exit crash has been fixed.

The input is the exact 19 JSON configuration filenames listed in `P0_WORK_ORDER.md`,
written by the P0-A verification program using its production `UnityJson.Read<T>`
and `UnityJson.Serialize` implementation. Put them directly in the roundtrip input
directory; keep provenance and manifests beside that directory.

For each of the 17 standalone combat configurations, the original and CLI-written
files are independently loaded by the real Unity `JsonUtility.FromJson`, run with
`CombatSession.RunToCompletion()`, and compared using exact UTF-8 bytes from
`ExportLogText()`. The full `CombatRunResult` JSON is also compared.

The two expedition configurations are each independently loaded and run through
the existing `CombatExpeditionSession.RunToEnd()` path on both sides. Their entire
reports are compared without dropping or rewriting fields. As the expedition API
has no log export, each actual encounter is replayed through the public
`CombatSession` constructor using that side's actual `previousBattleEnd`,
`carryTeam` and `waitBefore`. The replay start, final snapshot, steps and outcome
must match the actual expedition encounter record before its `ExportLogText()` is
accepted. The final total is **19 configurations, 17 standalone combat log pairs
and four carried encounter log pairs**; expedition replay is additional to the
complete expedition comparison.

The check refuses interactive execution, a non-Windows Editor, any Unity version
other than `6000.3.28f1`, or a non-null graphics device. It creates a new independent
output directory with `A6_RESULTS.json`, both sides' full report JSON, and both
sides' original log text. Input and log SHA-256 values identify the exact evidence.
No Player is built or started.

## Controlled Windows execution

Use the wrapper only after pure .NET verification passes, P0-B is frozen and the
coordinating session explicitly schedules this batch. Run the entire wrapper in
the normal desktop user's session outside AppContainer. Do not change licensing
configuration, user profile, environment or global settings to make it run.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  "C:/Users/lau/Documents/ChatGPT/mygame/Game/Assets/Prototype/Editor/SimCliRoundTrip/Run-SimCliUnityChecks.ps1" `
  -RepositoryRoot "C:/Users/lau/Documents/ChatGPT/mygame" `
  -RoundTripRoot "C:/Users/lau/Documents/ChatGPT/mygame/outputs/p0_20261116/roundtrip" `
  -OutputDirectory "C:/Users/lau/Documents/ChatGPT/mygame/outputs/p0_20261116/unity_batch_01"
```

The output directory must not exist. The wrapper runs exactly two serial Editor
processes with `-batchmode -nographics`:

1. EditMode tests from `Prototype.Combat.EditModeTests`, including P0-B, with a
   separate NUnit XML, Editor log, stdout and stderr. NUnit must report Passed,
   total > 0, failed = 0,
   and all 16 frozen `CombatScenarioComparisonTests` cases must be present and Passed.
   Their exact names/results are retained in the wrapper summary.
2. A6 through `Prototype.Editor.SimCliRoundTrip.SimCliRoundTripCheck.Run`. It starts
   only after the first Editor exits successfully and another process preflight
   confirms no existing `Unity.exe`.

Each stage records runner/child user, session, AppContainer state, PID, start time,
executable version/hash, actual command line, parent PID and surrounding Unity
process metadata. It checks project locks without removing them. No UI/window or
accessibility inspection is used. Other processes are never terminated.

Every two seconds, `resources.jsonl` records the owned Editor's CPU time, working
set, private bytes, handle/thread counts, Editor log length, physical availability
and commit headroom. A progress line is printed every ten seconds. Each stage has
an eight-minute default absolute timeout. A 90-second interval with no log growth
and less than 0.2 CPU seconds is recorded as a stall without asserting its cause.

The wrapper preserves at least max(8 GiB, 10% of total) in both physical memory and
commit headroom. Initial headroom must cover that reserve plus 2 GiB. Editor
working-set/private-byte limits are each the lesser of 12 GiB and their initial
headroom after the reserve. Crossing a reserve, process limit, 100,000 handles,
1,000 threads, an explicit crash marker or detecting another `Unity.exe` stops the
exact owned Editor after rechecking its identity. A failed or abnormal stage stops
all later stages; there are no automatic retries. Logs and failure summaries are
retained. A preflight failure does not count as a Unity test execution.
