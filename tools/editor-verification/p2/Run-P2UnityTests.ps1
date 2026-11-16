[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$UnityPath = 'E:/Unity/Editors/6000.3.28f1/Editor/Unity.exe',
    [ValidateRange(60, 900)][int]$TimeoutSeconds = 480,
    [switch]$Execute
)
# P2-specific runTests adapter. Native identity, raw BaseStream capture and resource
# guards are reused verbatim from the executed P1 launcher. Default: preflight only.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false)
$requiredVersion = '6000.3.28f1'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class P1UnityProcessInfo {
    [StructLayout(LayoutKind.Sequential)] public struct PerformanceInfo {
        public uint cb;
        public UIntPtr CommitTotal, CommitLimit, CommitPeak, PhysicalTotal, PhysicalAvailable,
            SystemCache, KernelTotal, KernelPaged, KernelNonpaged, PageSize;
        public uint HandleCount, ProcessCount, ThreadCount;
    }
    [DllImport("psapi.dll", SetLastError=true)] static extern bool GetPerformanceInfo(out PerformanceInfo value, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int returned);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static PerformanceInfo Memory() {
        PerformanceInfo value;
        if (!GetPerformanceInfo(out value, (uint)Marshal.SizeOf(typeof(PerformanceInfo)))) throw new Win32Exception(Marshal.GetLastWin32Error());
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
            if (!GetTokenInformation(token, 29, out value, 4, out returned)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return value != 0;
        } finally { if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
}
'@

function Full-Path([string]$Value) {
    if (-not [IO.Path]::IsPathRooted($Value)) { throw "Absolute path required: $Value" }
    [IO.Path]::GetFullPath($Value).TrimEnd([char[]]'\/')
}
function Write-Json([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ((ConvertTo-Json -InputObject $Value -Depth 14) + "`n"), $utf8)
}
function Hash-File([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Read-Memory {
    $value = [P1UnityProcessInfo]::Memory()
    $page = $value.PageSize.ToUInt64()
    [ordered]@{
        physicalTotal = $value.PhysicalTotal.ToUInt64() * $page
        physicalAvailable = $value.PhysicalAvailable.ToUInt64() * $page
        commitLimit = $value.CommitLimit.ToUInt64() * $page
        commitAvailable = ($value.CommitLimit.ToUInt64() - $value.CommitTotal.ToUInt64()) * $page
    }
}
function Read-Context([int]$ProcessId) {
    $value = Get-Process -Id $ProcessId -ErrorAction Stop
    [ordered]@{
        processId = $value.Id; executablePath = $value.Path
        startedAtUtc = $value.StartTime.ToUniversalTime().ToString('o')
        owner = [P1UnityProcessInfo]::Owner($ProcessId); sessionId = $value.SessionId
        isAppContainer = [P1UnityProcessInfo]::IsAppContainer($ProcessId)
    }
}
function Read-UnityProcesses {
    # Exact native process metadata query; no UI/window/accessibility enumeration.
    @(Get-CimInstance Win32_Process -Filter "Name = 'Unity.exe' OR Name = 'Unity Hub.exe' OR Name = 'Unity.Licensing.Client.exe' OR Name = 'UnityCrashHandler64.exe'" | ForEach-Object {
        [ordered]@{ processId = $_.ProcessId; parentProcessId = $_.ParentProcessId; name = $_.Name
            executablePath = $_.ExecutablePath; commandLine = $_.CommandLine; sessionId = $_.SessionId; creationDate = $_.CreationDate }
    })
}
function Assert-NoEditor([string]$EvidencePath) {
    try { $rows = @(Read-UnityProcesses) }
    catch { Write-Json $EvidencePath @{ unavailable = $true; error = $_.Exception.Message }; throw }
    Write-Json $EvidencePath $rows
    if (@($rows | Where-Object { $_.name -ieq 'Unity.exe' }).Count) { throw 'An existing Unity.exe blocks this run. No existing process was stopped.' }
    foreach ($lock in @((Join-Path $projectPath 'Temp/UnityLockfile'), (Join-Path $projectPath 'UnityLockfile'))) {
        if (-not (Test-Path -LiteralPath $lock)) { continue }
        $handle = $null
        try { $handle = [IO.File]::Open($lock, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None) }
        finally { if ($null -ne $handle) { $handle.Dispose() } }
    }
}
function Stop-OwnedEditor {
    if ($null -eq $editor -or $editor.HasExited) { return }
    $actual = Read-Context $editor.Id
    if ($actual.executablePath -ine $unityExecutable -or $actual.startedAtUtc -cne $summary.spawnContext.startedAtUtc -or
        $actual.owner -ine $summary.runnerContext.owner -or $actual.sessionId -ne $summary.runnerContext.sessionId) {
        throw 'Cannot reverify the retained owned Unity handle/image/start/user/session; no other process is stopped.'
    }
    $summary.stopContext = $actual
    $summary.stopRequested = $true
    $editor.Kill()
    if (-not $editor.WaitForExit(10000)) { throw 'The owned Editor did not exit after the stop request.' }
}


$repositoryPath = Full-Path $RepositoryRoot
$projectPath = Join-Path $repositoryPath 'Game'
$unityExecutable = Full-Path $UnityPath
$runRoot = Full-Path $OutputDirectory
$allowedOutput = (Join-Path $repositoryPath 'outputs/helper_editor_p2/verification') + [IO.Path]::DirectorySeparatorChar
if (-not $runRoot.StartsWith($allowedOutput, [StringComparison]::OrdinalIgnoreCase)) { throw 'Use a new directory under the dedicated P2 evidence root.' }
if (Test-Path -LiteralPath $runRoot) { throw "Evidence directory already exists: $runRoot" }
New-Item -ItemType Directory -Path $runRoot -ErrorAction Stop | Out-Null
$logPath = Join-Path $runRoot 'editor.log'
$stdoutPath = Join-Path $runRoot 'editor.stdout'
$stderrPath = Join-Path $runRoot 'editor.stderr'
$testResultsPath = Join-Path $runRoot 'tests.xml'
$summaryPath = Join-Path $runRoot 'P2_UNITY_BATCH_SUMMARY.json'
$testFilter = 'Prototype.Combat.Tests.CombatExpeditionLogTests;Prototype.Combat.Tests.CombatExpeditionTests;Prototype.Combat.Tests.CombatSampleRunsTests.ActualExpeditionJson_MatchesPerEncounterDispatchAndBatchDispatch'
# TestFramework 1.6.0 explicitly rejects -quit with command-line test execution.
$arguments = @('-batchmode', '-nographics', '-projectPath', $projectPath, '-runTests',
    '-testPlatform', 'EditMode', '-testFilter', $testFilter, '-testResults', $testResultsPath, '-logFile', $logPath)
$frozen = [ordered]@{
    'Game/Assets/Prototype/Combat/Runtime/CombatExpedition.cs' = '71a6959abadc7aff53e4c66d6e5c8375ad170f70dfdb046d4602effb279d5314'
    'Game/Assets/Prototype/Combat/Tests/EditMode/CombatExpeditionLogTests.cs' = '11cbaa6019dc17c206290983adb4e7f71974a461500222330039d7c0a928fe32'
    'Game/Assets/Prototype/Combat/Tests/EditMode/CombatExpeditionLogTests.cs.meta' = '7c4afd3b106fd4b4fe4cf6165371ce8ca86217ba7ee3cb6099efed5a2509b5b8'
    'work/p2_backend_build_004/sim-cli.dll' = '9790b3cdfa7246007a876810796660ad39ad2f1a088e187faa722fb3aa0be38d'
    'work/p2_verification_20261116/oracle_build_003/bin/P2.KernelOracle.dll' = 'd5abba3e89644c6a7be535d88367eeb302d2e93c40e82c93cc647b76c70866f8'
}
function Read-SourceSnapshot {
    $rows = @()
    foreach ($folder in @('Game/Assets', 'Game/Packages', 'Game/ProjectSettings')) {
        foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $repositoryPath $folder) -Recurse -File -Force | Sort-Object FullName)) {
            $rows += [ordered]@{ path = $file.FullName.Substring($repositoryPath.Length + 1).Replace('\', '/'); bytes = $file.Length; sha256 = Hash-File $file.FullName }
        }
    }
    foreach ($relative in @('work/p2_backend_build_004/sim-cli.dll', 'work/p2_verification_20261116/oracle_build_003/bin/P2.KernelOracle.dll', 'tools/editor-verification/p2/Run-P2UnityTests.ps1')) {
        $full = Join-Path $repositoryPath $relative
        $rows += [ordered]@{ path = $relative; bytes = (Get-Item -LiteralPath $full).Length; sha256 = Hash-File $full }
    }
    return $rows
}
$summary = [ordered]@{
    schemaVersion = 1; status = 'NotRun'; mode = $(if ($Execute) { 'Execute' } else { 'PreflightOnly' }); error = ''
    requiredUnityVersion = $requiredVersion; repositoryRoot = $repositoryPath; projectPath = $projectPath
    executable = $unityExecutable; arguments = $arguments; executableVersion = ''; executableSha256 = ''; projectVersion = ''
    testFilter = $testFilter; expectedTestCount = 25; tests = $null; testsFunctionalPassed = $false
    runnerContext = $null; spawnContext = $null; actualCommandLine = ''; processId = $null
    stopRequested = $false; stopContext = $null; stopError = ''; startedAtUtc = ''; completedAtUtc = ''; exitCode = $null
    limits = $null; memoryBefore = $null; memoryAfter = $null; stdout = $null; stderr = $null; diagnostics = @(); tailGate = $null
    sourceBefore = @(); sourceAfter = @(); sourceProtectionPassed = $false; approvedSourceHashes = $frozen
    inheritedBoundary = 'P1 B8 native-tail ReviewRequired/ordinary Player failure remain unresolved; no retry or second batch.'
}
$editor = $null; $resourceWriter = $null; $stdoutStream = $null; $stderrStream = $null; $stdoutTask = $null; $stderrTask = $null
$scriptExit = 1
try {
    foreach ($relative in $frozen.Keys) { if ((Hash-File (Join-Path $repositoryPath $relative)) -cne $frozen[$relative]) { throw "Frozen source/artifact mismatch: $relative" } }
    $inputManifestPath = Join-Path $repositoryPath 'outputs/helper_editor_p2/verification/preparation_20261116/ORIGINAL_INPUTS_PHYSICAL.json'
    $inputManifest = Get-Content -LiteralPath $inputManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($inputEntry in $inputManifest.inputs) { if ((Hash-File (Join-Path $repositoryPath $inputEntry.path)) -cne $inputEntry.sha256) { throw "Original input changed: $($inputEntry.path)" } }
    $summary.sourceBefore = @(Read-SourceSnapshot)
    Write-Json (Join-Path $runRoot 'source-pre.json') $summary.sourceBefore
    $versionText = [IO.File]::ReadAllText((Join-Path $projectPath 'ProjectSettings/ProjectVersion.txt'))
    $summary.projectVersion = [regex]::Match($versionText, '(?m)^m_EditorVersion:\s*(\S+)').Groups[1].Value
    $image = Get-Item -LiteralPath $unityExecutable
    $summary.executableVersion = $image.VersionInfo.ProductVersion
    $summary.executableSha256 = Hash-File $unityExecutable
    if ($summary.projectVersion -cne $requiredVersion -or -not $summary.executableVersion.StartsWith($requiredVersion + '_', [StringComparison]::Ordinal)) { throw 'Project and executable must both match Unity 6000.3.28f1.' }
    $summary.runnerContext = Read-Context $PID
    $summary.memoryBefore = Read-Memory
    Assert-NoEditor (Join-Path $runRoot 'processes-preflight.json')
    $memory = $summary.memoryBefore
    $physicalReserve = [Math]::Max(8GB, [Math]::Ceiling($memory.physicalTotal * 0.10))
    $commitReserve = [Math]::Max(8GB, [Math]::Ceiling($memory.commitLimit * 0.10))
    $summary.limits = [ordered]@{ physicalReserve = $physicalReserve; commitReserve = $commitReserve
        workingSetLimit = [Math]::Min(12GB, $memory.physicalAvailable - $physicalReserve)
        privateBytesLimit = [Math]::Min(12GB, $memory.commitAvailable - $commitReserve)
        timeoutSeconds = $TimeoutSeconds; stalledSeconds = 90; stalledCpuSeconds = 0.2; handleLimit = 100000; threadLimit = 1000 }
    if ($summary.limits.workingSetLimit -lt 2GB -or $summary.limits.privateBytesLimit -lt 2GB) { throw 'Host headroom is below reserve plus 2 GiB.' }
    Write-Json $summaryPath $summary
    if ($summary.runnerContext.isAppContainer -or $summary.runnerContext.sessionId -eq 0) { throw 'Preflight/execute requires the approved normal desktop user outside AppContainer.' }
    if (-not $Execute) {
        $summary.status = 'Ready_NotExecuted'
        $scriptExit = 0
        Write-Host "P2 preflight only; no Editor started. $summaryPath"
    }
    else {
        if ($summary.runnerContext.isAppContainer -or $summary.runnerContext.sessionId -eq 0) { throw 'Execute must run in the authorized normal desktop-user session outside AppContainer.' }
        $info = [Diagnostics.ProcessStartInfo]::new($unityExecutable)
        $info.WorkingDirectory = $projectPath; $info.UseShellExecute = $false; $info.CreateNoWindow = $true
        $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
        foreach ($argument in $arguments) { $info.ArgumentList.Add($argument) }
        $editor = [Diagnostics.Process]::new(); $editor.StartInfo = $info
        $summary.startedAtUtc = [DateTime]::UtcNow.ToString('o')
        $summary.status = 'Running'
        $stdoutStream = [IO.File]::Open($stdoutPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        $stderrStream = [IO.File]::Open($stderrPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        [void]$editor.Start(); $null = $editor.Handle; $summary.processId = $editor.Id
        $summary.spawnContext = [ordered]@{ executablePath = $editor.Path; startedAtUtc = $editor.StartTime.ToUniversalTime().ToString('o') }
        $stdoutTask = $editor.StandardOutput.BaseStream.CopyToAsync($stdoutStream)
        $stderrTask = $editor.StandardError.BaseStream.CopyToAsync($stderrStream)
        $summary.spawnContext = Read-Context $editor.Id
        $context = $summary.spawnContext
        if ($context.executablePath -ine $unityExecutable -or $context.owner -ine $summary.runnerContext.owner -or $context.sessionId -ne $summary.runnerContext.sessionId -or $context.isAppContainer) { throw 'Owned Editor identity differs from approved image/user/session.' }
        $processes = @(Read-UnityProcesses)
        Write-Json (Join-Path $runRoot 'processes-started.json') $processes
        $owned = @($processes | Where-Object { $_.processId -eq $editor.Id })
        if ($owned.Count -ne 1 -or $owned[0].parentProcessId -ne $PID -or $owned[0].commandLine -notmatch '(?i)(?:^|\s)-batchmode(?:\s|$)' -or $owned[0].commandLine -notmatch '(?i)(?:^|\s)-nographics(?:\s|$)') { throw 'Cannot verify the owned noninteractive command and parent PID.' }
        $summary.actualCommandLine = $owned[0].commandLine
        $projectArgument = [regex]::Match($summary.actualCommandLine, '(?i)(?:^|\s)-projectPath\s+(?:"(?<quoted>[^"]+)"|(?<plain>\S+))')
        $childProject = $projectArgument.Groups['quoted'].Value
        if (-not $childProject) { $childProject = $projectArgument.Groups['plain'].Value }
        if (-not $projectArgument.Success -or (Full-Path $childProject) -ine $projectPath -or -not $summary.actualCommandLine.Contains($testFilter) -or $summary.actualCommandLine -notmatch '(?i)(?:^|\s)-runTests(?:\s|$)' -or $summary.actualCommandLine -match '(?i)(?:^|\s)-quit(?:\s|$)') { throw 'Owned Editor project/filter/runTests differs from the planned command.' }
        Write-Json $summaryPath $summary
        $resourceWriter = [IO.StreamWriter]::new((Join-Path $runRoot 'resources.jsonl'), $false, $utf8); $resourceWriter.AutoFlush = $true
        $watch = [Diagnostics.Stopwatch]::StartNew(); $progressAt = 0.0; $progressCpu = 0.0; $logBytes = -1L; $lastNotice = -10.0
        while (-not $editor.HasExited) {
            $editor.Refresh(); if ($editor.HasExited) { break }
            $seconds = $watch.Elapsed.TotalSeconds; $currentMemory = Read-Memory; $cpu = $editor.TotalProcessorTime.TotalSeconds
            $length = if (Test-Path -LiteralPath $logPath) { (Get-Item -LiteralPath $logPath).Length } else { 0L }
            if ($length -ne $logBytes -or ($cpu - $progressCpu) -ge 0.2) { $progressAt = $seconds; $progressCpu = $cpu; $logBytes = $length }
            $sample = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); elapsedSeconds = $seconds; processId = $editor.Id
                cpuSeconds = $cpu; workingSet = $editor.WorkingSet64; privateBytes = $editor.PrivateMemorySize64; handles = $editor.HandleCount
                threads = $editor.Threads.Count; editorLogBytes = $length; physicalAvailable = $currentMemory.physicalAvailable; commitAvailable = $currentMemory.commitAvailable }
            $resourceWriter.WriteLine(($sample | ConvertTo-Json -Compress))
            $reason = ''
            if ($seconds -ge $TimeoutSeconds) { $reason = 'absolute timeout' }
            elseif ($currentMemory.physicalAvailable -lt $physicalReserve -or $currentMemory.commitAvailable -lt $commitReserve) { $reason = 'host physical/commit reserve crossed' }
            elseif ($editor.WorkingSet64 -gt $summary.limits.workingSetLimit -or $editor.PrivateMemorySize64 -gt $summary.limits.privateBytesLimit) { $reason = 'owned Editor memory limit crossed' }
            elseif ($editor.HandleCount -gt 100000 -or $editor.Threads.Count -gt 1000) { $reason = 'owned Editor handle/thread limit crossed' }
            elseif (($seconds - $progressAt) -ge 90) { $reason = '90 seconds without log growth and less than 0.2 CPU seconds' }
            if (@(Get-Process -Name Unity -ErrorAction SilentlyContinue | Where-Object Id -NE $editor.Id).Count) { $reason = 'another Unity.exe appeared' }
            if ($reason) { throw "Stopping only owned Editor: $reason" }
            if (($seconds - $lastNotice) -ge 10) {
                Write-Host "[P2 EditMode] PID=$($editor.Id), $([Math]::Round($seconds))s, CPU=$([Math]::Round($cpu,1))s, WS=$([Math]::Round($editor.WorkingSet64/1GB,2))GiB, log=$length B"
                $lastNotice = $seconds
                if (Test-Path -LiteralPath $logPath) {
                    $tail = (Get-Content -LiteralPath $logPath -Tail 40 -Encoding utf8) -join "`n"
                    if ($tail -match '(?im)^Crash!!!|^Fatal Error|^Received signal|^Segmentation fault') { throw 'Explicit fatal/crash signal in owned Editor log.' }
                }
            }
            Start-Sleep -Milliseconds 2000
        }
        $editor.WaitForExit(); $summary.exitCode = $editor.ExitCode
        if ($summary.exitCode -ne 0) { throw "Owned Editor exited $($summary.exitCode)." }
        $tailLines = @(Get-Content -LiteralPath $logPath -Tail 160 -Encoding utf8)
        $tailText = $tailLines -join "`n"
        $completeLog = [IO.File]::ReadAllText($logPath)
        [IO.File]::WriteAllText((Join-Path $runRoot 'editor-tail-review.txt'), $tailText + "`n", $utf8)
        if ($completeLog -match '(?im)Crash!!!|Fatal Error|Received signal|Segmentation fault') {
            $summary.tailGate = @{ status = 'Fatal'; reason = 'Explicit fatal signal in final Editor log tail; no further Unity batch.' }
            throw 'Final Editor log tail contains a fatal/crash signal despite the recorded exit code.'
        }
        $tailConcerns = @($tailLines | Where-Object { $_ -match '(?i)abort|Curl.*42|debugger.*(port|unable|fail|error)|allocator.*(leak|error|fail|unfreed)|unfreed' })
        $summary.tailGate = @{ status = $(if ($tailConcerns.Count) { 'ReviewRequired' } else { 'Clean' }); concerns = $tailConcerns
            rule = 'Unknown mono/debugger/allocator tail diagnostics require root review. This launcher schedules no additional Unity batch.' }
        if (-not (Test-Path -LiteralPath $testResultsPath -PathType Leaf)) { throw 'NUnit test results are missing.' }
        [xml]$testXml = [IO.File]::ReadAllText($testResultsPath)
        $cases = @($testXml.SelectNodes('//test-case'))
        $rows = @($cases | ForEach-Object { [ordered]@{ fullName = $_.GetAttribute('fullname'); name = $_.GetAttribute('name'); result = $_.GetAttribute('result'); duration = $_.GetAttribute('duration') } })
        $newCount = @($rows | Where-Object { $_.fullName.StartsWith('Prototype.Combat.Tests.CombatExpeditionLogTests.', [StringComparison]::Ordinal) }).Count
        $oldCount = @($rows | Where-Object { $_.fullName.StartsWith('Prototype.Combat.Tests.CombatExpeditionTests.', [StringComparison]::Ordinal) }).Count
        $actualCount = @($rows | Where-Object { $_.fullName.StartsWith('Prototype.Combat.Tests.CombatSampleRunsTests.ActualExpeditionJson_MatchesPerEncounterDispatchAndBatchDispatch', [StringComparison]::Ordinal) }).Count
        $summary.tests = [ordered]@{ path = $testResultsPath; sha256 = Hash-File $testResultsPath; actualCount = $cases.Count; passedCount = @($rows | Where-Object result -eq 'Passed').Count; newObserverCount = $newCount; oldExpeditionCount = $oldCount; actualJsonCount = $actualCount; cases = $rows }
        Write-Json (Join-Path $runRoot 'TEST_CASES.json') $summary.tests
        if ($cases.Count -ne 25 -or $summary.tests.passedCount -ne 25 -or $newCount -ne 15 -or $oldCount -ne 9 -or $actualCount -ne 1) { throw 'Required 15+9+1 cases were not all executed and passed; no discovery retry is scheduled.' }
        $summary.testsFunctionalPassed = $true
        $summary.status = if ($tailConcerns.Count) { 'TestsPassed_Exit0_ReviewRequired' } else { 'TestsPassed_Exit0_RootReviewPending' }
        $scriptExit = if ($tailConcerns.Count) { 3 } else { 0 }
    }
}

catch {
    $summary.status = 'Failed'; $summary.error = $_.Exception.Message
    try { Stop-OwnedEditor } catch { $summary.stopError = $_.Exception.Message }
    Write-Error -Message $summary.error -ErrorAction Continue
}
finally {
    if ($null -ne $resourceWriter) { $resourceWriter.Dispose() }
    foreach ($task in @($stdoutTask, $stderrTask)) { if ($null -ne $task) { try { $null = $task.GetAwaiter().GetResult() } catch { $summary.error += ' Capture error: ' + $_.Exception.Message; $summary.status = 'Failed' } } }
    if ($null -ne $stdoutStream) { $stdoutStream.Dispose() }; if ($null -ne $stderrStream) { $stderrStream.Dispose() }
    if (Test-Path -LiteralPath $stdoutPath) { $summary.stdout = @{ path = $stdoutPath; sha256 = Hash-File $stdoutPath; bytes = (Get-Item -LiteralPath $stdoutPath).Length } }
    if (Test-Path -LiteralPath $stderrPath) { $summary.stderr = @{ path = $stderrPath; sha256 = Hash-File $stderrPath; bytes = (Get-Item -LiteralPath $stderrPath).Length } }
    if ($null -ne $editor -and $editor.HasExited) { $summary.exitCode = $editor.ExitCode }
    try {
        $summary.memoryAfter = Read-Memory
        $afterProcesses = @(Read-UnityProcesses)
        Write-Json (Join-Path $runRoot 'processes-after.json') $afterProcesses
        if ($Execute -and @($afterProcesses | Where-Object { $_.name -ieq 'Unity.exe' }).Count) { throw 'Editor still present after the owned batch; no process is closed by name.' }
        $summary.sourceAfter = @(Read-SourceSnapshot)
        Write-Json (Join-Path $runRoot 'source-post.json') $summary.sourceAfter
        $summary.sourceProtectionPassed = (ConvertTo-Json -InputObject $summary.sourceBefore -Depth 6 -Compress) -ceq (ConvertTo-Json -InputObject $summary.sourceAfter -Depth 6 -Compress)
        if (-not $summary.sourceProtectionPassed) { throw 'Protected source/artifact bytes or paths changed; root review required.' }
    } catch { $summary.error += ' Postflight unavailable/mismatch: ' + $_.Exception.Message; $summary.status = 'Failed'; $scriptExit = 1 }
    if (Test-Path -LiteralPath $logPath) { $summary.diagnostics = @(Select-String -LiteralPath $logPath -Pattern 'mono.*abort|debugger.*port|allocator|Curl.*42|Crash!!!|Fatal Error|Received signal|Segmentation fault' | ForEach-Object { @{ line = $_.LineNumber; text = $_.Line } }) }
    $summary.completedAtUtc = [DateTime]::UtcNow.ToString('o')
    if ($summary.status -eq 'Failed') { $scriptExit = 1 }
    Write-Json $summaryPath $summary
    Write-Host "P2 Unity status=$($summary.status); summary=$summaryPath"
    if ($null -ne $editor) { $editor.Dispose() }
}
exit $scriptExit
