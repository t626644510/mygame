# P2 independent verification

Only this directory and the central P2 verification report belong to the verifier.
Product sources, original inputs, Runtime, P1 tests, dependencies and Git remain with
their respective owners. Artifacts go to `outputs/helper_editor_p2/verification/`
and isolated data to `work/p2_verification_20261116/`.

`kernel-oracle/P2.KernelOracle.csproj` directly compiles the existing Game combat
sources and the existing `UnityJson` reader. It has no UnityEngine dependency or
product-project build reference. Run the pinned SDK 8.0.428 from a working
directory governed by `tools/sim-cli/global.json`; direct build output and
intermediate files to the isolated work root. No new SDK or browser is downloaded.

Oracle modes: `single`, `snapshot`, `linked`, `compare-priority`, `compare`, and
`action-equivalent`. Each requires `--out <fresh-directory>`. `compare` and
`action-equivalent` additionally require `--variant <file>`.
The `single` defaults are the actual direct CLI defaults: 10000 steps / 100000 WAIT.
It stores exact input bytes, normalized configuration, initial snapshot, actual
run result and `UTF8.GetBytes(ExportLogText())` without newline conversion.

The root approved the public `ExportEncounterLogText` observer. `linked` runs one
real `CombatExpeditionSession`, then reads each completed record's cached log
from that same instance. It does not replay or rebuild a log from a report. Two
reads must return identical text and leave the settled report byte-identical.
Rebuild against the explicitly frozen Runtime before using this mode. A CLI C2
check also requires the expected observer source SHA and a ready product adapter.
There is no reflection, replacement carry algorithm, fake log formatter, browser
mock or product implementation in the oracle. Unity is separately scheduled.

For CI, build the product CLI to a fresh output first, then run
`build-oracle.mjs --dotnet <absolute-dotnet> --output <fresh-verification-output>
--work <fresh-verification-work>`. Pass the resulting `ORACLE_BUILD.json` to
`cli-checks.mjs` with `--only C1,C2,C3`, the actual product DLL path/SHA,
the frozen API contract SHA and the approved observer source SHA. The required
options are `--dotnet`, `--cli`, `--expected-cli-sha`, `--oracle-build`,
`--contract-sha`, `--output`, `--work`; C2 also requires
`--observer-source-sha`. Optional `--build-receipt` preserves the product build
identity. These CLI checks are pure .NET/Node and compare logs on the same host;
they do not run Unity, Playwright, PowerShell process inspection or a server.

The snapshot oracle also stores the actual public `GetAvailableActions` result
and, separately, `NormalizeActionDefinition` results. They have different
contracts: available actions retain copied source fields, while normalized
metadata has the core's explicit defaults. Never substitute one for the other.

`captureInputs` separates physical input SHA/EOL from independently supplied Git
blob provenance. Compare original/assembled logs on the same platform. Never
compare old Windows raw directly against another platform as if both were the
same byte source. The inherited raw collector preserves identical bytes for
stdout, stderr, HTTP bodies and SHA; JSON helpers must not normalize raw logs.

Actual C1–C14 outcomes, first failures, frozen source versions and evidence paths
are recorded in `docs/editor/P2_VERIFICATION.md`. Plans are never PASS results.
