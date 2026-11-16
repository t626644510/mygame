[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$RoundTripRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$UnityPath = 'E:/Unity/Editors/6000.3.28f1/Editor/Unity.exe',
    [ValidateRange(60, 900)][int]$TimeoutSeconds = 480
)

# Run only after the pure .NET checks, P0-B freeze and explicit batch scheduling.
# No Player, graphical Editor, UI automation, license changes, or automatic retries.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false)
$requiredVersion = '6000.3.28f1'

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class P0UnityProcessInfo {
    [StructLayout(LayoutKind.Sequential)] public struct PerformanceInfo {
        public uint cb;
        public UIntPtr CommitTotal, CommitLimit, CommitPeak, PhysicalTotal, PhysicalAvailable,
            SystemCache, KernelTotal, KernelPaged, KernelNonpaged, PageSize;
        public uint HandleCount, ProcessCount, ThreadCount;
    }
    [DllImport("psapi.dll", SetLastError=true)]
    static extern bool GetPerformanceInfo(out PerformanceInfo value, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("advapi32.dll", SetLastError=true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)]
    static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int returned);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static PerformanceInfo Memory() {
        PerformanceInfo value;
        if (!GetPerformanceInfo(out value, (uint)Marshal.SizeOf(typeof(PerformanceInfo))))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return value;
    }
    public static string Owner(int pid) {
        IntPtr process = OpenProcess(0x1000, false, pid), token = IntPtr.Zero;
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            if (!OpenProcessToken(process, 8, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
            using (WindowsIdentity identity = new WindowsIdentity(token)) return identity.Name;
        } finally { if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
    public static bool IsAppContainer(int pid) {
        IntPtr process = OpenProcess(0x1000, false, pid), token = IntPtr.Zero;
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            if (!OpenProcessToken(process, 8, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
            int value, returned;
            if (!GetTokenInformation(token, 29, out value, 4, out returned))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return value != 0;
        } finally { if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
}
'@

function Full-Path([string]$Value) {
    if (-not [IO.Path]::IsPathRooted($Value)) { throw "Absolute path required: $Value" }
    [IO.Path]::GetFullPath($Value).TrimEnd([char[]]'\/')
}

function Quote-Path([string]$Value) {
    if ($Value.Contains('"')) { throw 'A path cannot contain a double quote.' }
    '"' + $Value + ('\' * [regex]::Match($Value, '\\+$').Length) + '"'
}

function Write-Json([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ((ConvertTo-Json -InputObject $Value -Depth 12) + "`n"), $utf8)
}

function Read-Memory {
    $value = [P0UnityProcessInfo]::Memory()
    $page = $value.PageSize.ToUInt64()
    [pscustomobject][ordered]@{
        physicalTotal = $value.PhysicalTotal.ToUInt64() * $page
        physicalAvailable = $value.PhysicalAvailable.ToUInt64() * $page
        commitLimit = $value.CommitLimit.ToUInt64() * $page
        commitUsed = $value.CommitTotal.ToUInt64() * $page
        commitAvailable = ($value.CommitLimit.ToUInt64() - $value.CommitTotal.ToUInt64()) * $page
    }
}

function Read-Context([int]$ProcessId) {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    [pscustomobject][ordered]@{
        processId = $process.Id
        executablePath = $process.Path
        startedAtUtc = $process.StartTime.ToUniversalTime().ToString('o')
        owner = [P0UnityProcessInfo]::Owner($ProcessId)
        sessionId = $process.SessionId
        isAppContainer = [P0UnityProcessInfo]::IsAppContainer($ProcessId)
    }
}

function Read-UnityProcesses {
    # Native process metadata only; never queries any UI/window/accessibility tree.
    @(Get-CimInstance Win32_Process -Filter "Name = 'Unity.exe' OR Name = 'Unity Hub.exe' OR Name = 'Unity.Licensing.Client.exe' OR Name = 'UnityCrashHandler64.exe'" |
        ForEach-Object {
            $instance = $_
            $owner = ''
            $ownerError = ''
            try { $owner = [P0UnityProcessInfo]::Owner($instance.ProcessId) }
            catch { $ownerError = $_.Exception.Message }
            [pscustomobject][ordered]@{
                processId = $instance.ProcessId
                parentProcessId = $instance.ParentProcessId
                name = $instance.Name
                executablePath = $instance.ExecutablePath
                commandLine = $instance.CommandLine
                owner = $owner
                ownerQueryError = $ownerError
                sessionId = $instance.SessionId
                creationDate = $instance.CreationDate
            }
        })
}

function Assert-NoEditor([string]$EvidencePath) {
    try { $processes = @(Read-UnityProcesses) }
    catch {
        Write-Json $EvidencePath ([pscustomobject]@{ status = 'Unavailable'; error = $_.Exception.Message })
        throw
    }
    Write-Json $EvidencePath $processes
    if (@($processes | Where-Object { $_.name -ieq 'Unity.exe' }).Count -gt 0) {
        throw "An existing Unity.exe process blocks this batch; see $EvidencePath. No existing process was stopped."
    }
    foreach ($path in @((Join-Path $projectPath 'Temp/UnityLockfile'), (Join-Path $projectPath 'UnityLockfile'))) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $handle = $null
        try { $handle = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None) }
        finally { if ($null -ne $handle) { $handle.Dispose() } }
    }
}

function Stop-OwnedEditor($Process, $Record) {
    if ($Process.HasExited) { return }
    $actual = Read-Context $Process.Id
    # Identity is tied to our retained process handle, exact image and creation time.
    if ($actual.executablePath -ine $unityExecutable -or $actual.startedAtUtc -cne $Record.spawnContext.startedAtUtc -or
        $actual.owner -ine $summary.runnerContext.owner -or $actual.sessionId -ne $summary.runnerContext.sessionId) {
        throw 'Could not reverify the exact owned Editor process; no other process will be stopped.'
    }
    $Record.stopContext = $actual
    $Record.stopRequested = $true
    $Process.Kill()
    if (-not $Process.WaitForExit(10000)) { throw 'The owned Editor did not exit after the stop request.' }
}

function Run-Stage($Record, [string[]]$StageArguments) {
    $stageRoot = Join-Path $runRoot $Record.name
    New-Item -ItemType Directory -Path $stageRoot -ErrorAction Stop | Out-Null
    $Record.logFile = Join-Path $stageRoot 'editor.log'
    $Record.standardOutput = Join-Path $stageRoot 'editor.stdout.txt'
    $Record.standardError = Join-Path $stageRoot 'editor.stderr.txt'
    Assert-NoEditor (Join-Path $stageRoot 'processes-before.json')
    $baselineMemory = Read-Memory
    $physicalReserve = [Math]::Max(8GB, [Math]::Ceiling($baselineMemory.physicalTotal * 0.10))
    $commitReserve = [Math]::Max(8GB, [Math]::Ceiling($baselineMemory.commitLimit * 0.10))
    $limits = [pscustomobject][ordered]@{
        physicalReserve = $physicalReserve
        commitReserve = $commitReserve
        workingSetLimit = [Math]::Min(12GB, $baselineMemory.physicalAvailable - $physicalReserve)
        privateBytesLimit = [Math]::Min(12GB, $baselineMemory.commitAvailable - $commitReserve)
        handleLimit = 100000
        threadLimit = 1000
        timeoutSeconds = $TimeoutSeconds
        stalledSeconds = 90
        stalledCpuSeconds = 0.2
    }
    $Record.memoryBefore = $baselineMemory
    $Record.limits = $limits
    if ($limits.workingSetLimit -lt 2GB -or $limits.privateBytesLimit -lt 2GB) {
        throw 'Host physical/commit headroom is below the reserve plus 2 GiB; Editor was not started.'
    }

    $arguments = @('-batchmode', '-nographics', '-projectPath', (Quote-Path $projectPath),
        '-logFile', (Quote-Path $Record.logFile)) + $StageArguments
    $Record.commandLine = (Quote-Path $unityExecutable) + ' ' + ($arguments -join ' ')
    $Record.startedAtUtc = [DateTime]::UtcNow.ToString('o')
    $Record.status = 'Running'
    Write-Json $summaryPath $summary
    $process = $null
    $writer = $null
    try {
        $process = Start-Process -FilePath $unityExecutable -ArgumentList ($arguments -join ' ') -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput $Record.standardOutput -RedirectStandardError $Record.standardError -PassThru
        $null = $process.Handle
        $Record.processId = $process.Id
        # Preserve image/start proof even if a later token query is unavailable.
        $Record.spawnContext = [pscustomobject]@{
            executablePath = $process.Path
            startedAtUtc = $process.StartTime.ToUniversalTime().ToString('o')
        }
        $Record.spawnContext = Read-Context $process.Id
        $context = $Record.spawnContext
        if ($context.isAppContainer -or $context.sessionId -ne $summary.runnerContext.sessionId -or
            $context.owner -ine $summary.runnerContext.owner -or $context.executablePath -ine $unityExecutable) {
            throw 'The owned child does not match the approved desktop user/session/image.'
        }
        $instances = @(Read-UnityProcesses)
        Write-Json (Join-Path $stageRoot 'processes-started.json') $instances
        $child = @($instances | Where-Object { $_.processId -eq $process.Id })
        if ($child.Count -ne 1 -or [string]::IsNullOrWhiteSpace($child[0].commandLine) -or
            $child[0].commandLine -notmatch '(?i)(?:^|\s)-batchmode(?:\s|$)' -or
            $child[0].commandLine -notmatch '(?i)(?:^|\s)-nographics(?:\s|$)' -or
            $child[0].parentProcessId -ne $PID) {
            throw 'Cannot verify the owned Editor command line and parent PID.'
        }
        $Record.actualCommandLine = $child[0].commandLine
        $projectArgument = [regex]::Match($child[0].commandLine, '(?i)(?:^|\s)-projectPath\s+(?:"(?<quoted>[^"]+)"|(?<plain>\S+))')
        $childProject = $projectArgument.Groups['quoted'].Value
        if (-not $childProject) { $childProject = $projectArgument.Groups['plain'].Value }
        if (-not $projectArgument.Success -or (Full-Path $childProject) -ine $projectPath) {
            throw 'Owned Editor command line does not contain the exact project path.'
        }
        Write-Json $summaryPath $summary
        Write-Host "[$($Record.name)] owned Unity PID=$($process.Id), user=$($context.owner), session=$($context.sessionId), AppContainer=$($context.isAppContainer)"
        $writer = New-Object IO.StreamWriter((Join-Path $stageRoot 'resources.jsonl'), $false, $utf8)
        $writer.AutoFlush = $true
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $lastProgressAt = 0.0
        $lastProgressCpu = 0.0
        $lastLength = -1L
        $lastNoticeAt = -10.0
        while (-not $process.HasExited) {
            $process.Refresh()
            if ($process.HasExited) { break }
            $seconds = $watch.Elapsed.TotalSeconds
            $memory = Read-Memory
            $cpu = $process.TotalProcessorTime.TotalSeconds
            $length = if (Test-Path -LiteralPath $Record.logFile) { (Get-Item -LiteralPath $Record.logFile).Length } else { 0L }
            if ($length -ne $lastLength -or ($cpu - $lastProgressCpu) -ge $limits.stalledCpuSeconds) {
                $lastProgressAt = $seconds
                $lastProgressCpu = $cpu
                $lastLength = $length
            }
            $sample = [pscustomobject][ordered]@{
                utc = [DateTime]::UtcNow.ToString('o')
                elapsedSeconds = [Math]::Round($seconds, 3)
                processId = $process.Id
                cpuSeconds = $cpu
                workingSet = $process.WorkingSet64
                privateBytes = $process.PrivateMemorySize64
                handles = $process.HandleCount
                threads = $process.Threads.Count
                editorLogBytes = $length
                physicalAvailable = $memory.physicalAvailable
                commitAvailable = $memory.commitAvailable
            }
            $writer.WriteLine(($sample | ConvertTo-Json -Compress))
            $reason = ''
            if ($seconds -ge $limits.timeoutSeconds) { $reason = 'absolute stage timeout' }
            elseif ($memory.physicalAvailable -lt $limits.physicalReserve -or $memory.commitAvailable -lt $limits.commitReserve) { $reason = 'host memory reserve crossed' }
            elseif ($sample.workingSet -gt $limits.workingSetLimit -or $sample.privateBytes -gt $limits.privateBytesLimit) { $reason = 'owned Editor memory limit crossed' }
            elseif ($sample.handles -gt $limits.handleLimit -or $sample.threads -gt $limits.threadLimit) { $reason = 'owned Editor handle/thread limit crossed' }
            elseif (($seconds - $lastProgressAt) -ge $limits.stalledSeconds) { $reason = '90 seconds with no log growth and less than 0.2 CPU seconds; cause undetermined' }
            $otherEditors = @(Get-Process -Name Unity -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $process.Id })
            if ($otherEditors.Count -gt 0) {
                Write-Json (Join-Path $stageRoot 'processes-conflict.json') @(Read-UnityProcesses)
                $reason = 'another Unity.exe appeared during this batch'
            }
            if ($reason) { throw "Stopping the owned Editor and remaining stages: $reason." }
            if (($seconds - $lastNoticeAt) -ge 10) {
                Write-Host "[$($Record.name)] $([Math]::Round($seconds))s; CPU=$([Math]::Round($cpu, 1))s; WS=$([Math]::Round($sample.workingSet / 1GB, 2))GiB; private=$([Math]::Round($sample.privateBytes / 1GB, 2))GiB; handles=$($sample.handles); log=$length B"
                $lastNoticeAt = $seconds
                if (Test-Path -LiteralPath $Record.logFile) {
                    $tail = (Get-Content -LiteralPath $Record.logFile -Tail 30 -Encoding UTF8) -join "`n"
                    if ($tail -match '(?im)^Crash!!!|^Fatal Error|^Received signal|^Segmentation fault') {
                        throw 'An explicit crash/fatal signal marker appeared in the owned Editor log.'
                    }
                }
            }
            Start-Sleep -Milliseconds 2000
        }
        $process.WaitForExit()
        $process.Refresh()
        $Record.exitCode = $process.ExitCode
        if ($Record.exitCode -ne 0) { throw "Owned Editor exited with code $($Record.exitCode)." }
        if (-not (Test-Path -LiteralPath $Record.logFile -PathType Leaf)) { throw 'Owned Editor log is missing.' }
        if ($Record.name -eq 'editmode') {
            [xml]$tests = [IO.File]::ReadAllText($Record.testResults)
            $testRun = $tests.DocumentElement
            $comparisonTests = @($tests.SelectNodes('//test-case') | Where-Object {
                $_.GetAttribute('fullname').StartsWith('Prototype.Combat.Tests.CombatScenarioComparisonTests.', [StringComparison]::Ordinal)
            } | ForEach-Object {
                [pscustomobject]@{ name = $_.GetAttribute('name'); fullName = $_.GetAttribute('fullname'); result = $_.GetAttribute('result') }
            })
            $Record.testSummary = [pscustomobject]@{
                result = $testRun.GetAttribute('result')
                total = $testRun.GetAttribute('total')
                passed = $testRun.GetAttribute('passed')
                failed = $testRun.GetAttribute('failed')
                skipped = $testRun.GetAttribute('skipped')
                comparisonTests = $comparisonTests
            }
            if ($testRun.LocalName -ne 'test-run' -or $Record.testSummary.result -cne 'Passed' -or
                [int]$Record.testSummary.total -le 0 -or [int]$Record.testSummary.failed -ne 0) {
                throw 'NUnit must report Passed, total > 0 and failed = 0.'
            }
            if ($comparisonTests.Count -ne 16 -or @($comparisonTests | Where-Object { $_.result -cne 'Passed' }).Count -ne 0) {
                throw 'All 16 frozen P0-B CombatScenarioComparisonTests cases must be present and Passed in the real NUnit XML.'
            }
        }
        else {
            $result = Get-Content -LiteralPath $Record.a6Results -Raw -Encoding UTF8 | ConvertFrom-Json
            if (-not $result.passed -or $result.passedConfigurationCount -ne 19 -or $result.comparedLogPairs -ne 21 -or
                $result.unityVersion -cne $requiredVersion -or $result.graphicsDevice -cne 'Null' -or -not $result.batchMode) {
                throw 'A6 report did not pass all 19 configurations and 21 exact log pairs in the required Editor mode.'
            }
        }
        $Record.status = 'Passed'
    }
    catch {
        $Record.status = 'Failed'
        $Record.error = $_.Exception.Message
        if ($null -ne $process -and -not $process.HasExited) {
            try { Stop-OwnedEditor $process $Record }
            catch { $Record.stopError = $_.Exception.Message }
        }
        if ($null -ne $process -and $process.HasExited) { $process.Refresh(); $Record.exitCode = $process.ExitCode }
        throw
    }
    finally {
        if ($null -ne $writer) { $writer.Dispose() }
        $Record.completedAtUtc = [DateTime]::UtcNow.ToString('o')
        $Record.memoryAfter = Read-Memory
        try { Write-Json (Join-Path $stageRoot 'processes-after.json') @(Read-UnityProcesses) }
        catch {
            Write-Json (Join-Path $stageRoot 'processes-after.json') ([pscustomobject]@{ status = 'Unavailable'; error = $_.Exception.Message })
            $Record.status = 'Failed'
            $Record.error += ' Post-stage process query unavailable: ' + $_.Exception.Message
            Write-Json $summaryPath $summary
            throw
        }
        Write-Json $summaryPath $summary
        if ($null -ne $process) { $process.Dispose() }
    }
}

$repositoryPath = Full-Path $RepositoryRoot
$projectPath = Join-Path $repositoryPath 'Game'
$roundTripPath = Full-Path $RoundTripRoot
$unityExecutable = Full-Path $UnityPath
$runRoot = Full-Path $OutputDirectory
if (-not $runRoot.StartsWith((Join-Path $repositoryPath 'outputs') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputDirectory must be a new directory below the repository outputs directory.'
}
if (Test-Path -LiteralPath $runRoot) { throw "OutputDirectory must not exist: $runRoot" }
New-Item -ItemType Directory -Path $runRoot -ErrorAction Stop | Out-Null
$summaryPath = Join-Path $runRoot 'UNITY_BATCH_SUMMARY.json'
$stages = @('editmode', 'a6') | ForEach-Object {
    [pscustomobject][ordered]@{
        name = $_; status = 'NotRun'; error = ''; startedAtUtc = ''; completedAtUtc = ''
        commandLine = ''; actualCommandLine = ''; processId = $null; spawnContext = $null
        stopContext = $null; stopRequested = $false; stopError = ''; exitCode = $null
        memoryBefore = $null; memoryAfter = $null; limits = $null; logFile = ''; standardOutput = ''; standardError = ''
        testResults = ''; testSummary = $null; a6Results = ''
    }
}
$summary = [pscustomobject][ordered]@{
    schemaVersion = 1; status = 'NotRun'; error = ''; requiredUnityVersion = $requiredVersion
    repositoryRoot = $repositoryPath; projectPath = $projectPath; roundTripRoot = $roundTripPath
    unityPath = $unityExecutable; executableVersion = ''; executableSha256 = ''; projectVersion = ''
    runnerContext = $null; memoryPreflight = $null; stages = @($stages)
}
$scriptExitCode = 1
try {
    $summary.runnerContext = Read-Context $PID
    $summary.memoryPreflight = Read-Memory
    if ($summary.runnerContext.isAppContainer -or $summary.runnerContext.sessionId -eq 0) {
        throw 'Run the entire wrapper in the authorized normal desktop-user session, outside AppContainer.'
    }
    $version = [IO.File]::ReadAllText((Join-Path $projectPath 'ProjectSettings/ProjectVersion.txt'))
    $summary.projectVersion = [regex]::Match($version, '(?m)^m_EditorVersion:\s*(\S+)').Groups[1].Value
    $file = Get-Item -LiteralPath $unityExecutable
    $summary.executableVersion = $file.VersionInfo.ProductVersion
    $summary.executableSha256 = (Get-FileHash -LiteralPath $unityExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($summary.projectVersion -cne $requiredVersion -or -not $summary.executableVersion.StartsWith($requiredVersion + '_', [StringComparison]::Ordinal)) {
        throw 'Project and executable must both match Unity 6000.3.28f1.'
    }
    $expectedNames = @(Get-ChildItem -LiteralPath (Join-Path $projectPath 'Assets/StreamingAssets/Prototype/Combat') -Filter '*.json' -File | Select-Object -ExpandProperty Name | Sort-Object)
    $roundTripNames = @(Get-ChildItem -LiteralPath $roundTripPath -Filter '*.json' -File | Select-Object -ExpandProperty Name | Sort-Object)
    if ($expectedNames.Count -ne 19 -or (Compare-Object $expectedNames $roundTripNames)) {
        throw 'Roundtrip input must contain the exact 19 source configuration filenames.'
    }
    Assert-NoEditor (Join-Path $runRoot 'processes-preflight.json')
    $summary.status = 'Running'
    $stages[0].testResults = Join-Path $runRoot 'editmode/results.xml'
    Run-Stage $stages[0] @('-runTests', '-testPlatform', 'EditMode', '-assemblyNames', 'Prototype.Combat.EditModeTests',
        '-testResults', (Quote-Path $stages[0].testResults))
    # A fresh preflight is performed inside Run-Stage; no overlapping Editor.
    $a6Output = Join-Path $runRoot 'a6/result'
    $stages[1].a6Results = Join-Path $a6Output 'A6_RESULTS.json'
    Run-Stage $stages[1] @('-quit', '-executeMethod', 'Prototype.Editor.SimCliRoundTrip.SimCliRoundTripCheck.Run',
        '-simCliRoundTripRoot', (Quote-Path $roundTripPath), '-simCliRoundTripOutput', (Quote-Path $a6Output))
    $summary.status = 'Passed'
    $scriptExitCode = 0
}
catch {
    $summary.status = 'Failed'
    $summary.error = $_.Exception.Message
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
}
finally {
    foreach ($stage in $stages) {
        if ($stage.status -eq 'NotRun') { $stage.status = 'Skipped'; $stage.error = 'Preflight or an earlier stage did not pass; no retry.' }
    }
    Write-Json $summaryPath $summary
    Write-Host "Unity batch status: $($summary.status); summary=$summaryPath"
}
exit $scriptExitCode
