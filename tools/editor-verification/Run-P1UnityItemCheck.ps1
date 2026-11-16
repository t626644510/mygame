#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$ItemsInput,
    [Parameter(Mandatory = $true)][string]$SourceContentRoot,
    [Parameter(Mandatory = $true)][string]$FormalItemsInput,
    [Parameter(Mandatory = $true)][string]$FormalSourceContentRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$UnityPath = 'E:/Unity/Editors/6000.3.28f1/Editor/Unity.exe',
    [string]$NodePath = 'node.exe',
    [ValidateRange(60, 900)][int]$TimeoutSeconds = 480,
    [switch]$Execute
)

# New P1-only launcher. It never invokes the P0 runner or any Player.
# Without -Execute it records a plan and never starts Unity. Root schedules
# -Execute only after pure service/browser checks and command review.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
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
$itemsPath = Full-Path $ItemsInput
$sourceRoot = Full-Path $SourceContentRoot
$formalItemsPath = Full-Path $FormalItemsInput
$formalSourceRoot = Full-Path $FormalSourceContentRoot
if ($formalItemsPath -ine (Join-Path $projectPath 'Assets/StreamingAssets/Content/items.json')) { throw 'Primary input must be the actual Game StreamingAssets Content items.json.' }
$unityExecutable = Full-Path $UnityPath
$runRoot = Full-Path $OutputDirectory
$allowedOutput = (Join-Path $repositoryPath 'outputs') + [IO.Path]::DirectorySeparatorChar
if (-not $runRoot.StartsWith($allowedOutput, [StringComparison]::OrdinalIgnoreCase)) { throw 'OutputDirectory must be a new directory below repository outputs.' }
if (Test-Path -LiteralPath $runRoot) { throw "Evidence directory already exists: $runRoot" }
New-Item -ItemType Directory -Path $runRoot -ErrorAction Stop | Out-Null
$resultRoot = Join-Path $runRoot 'unity-result'
$logPath = Join-Path $runRoot 'editor.log'
$stdoutPath = Join-Path $runRoot 'editor.stdout'
$stderrPath = Join-Path $runRoot 'editor.stderr'
$summaryPath = Join-Path $runRoot 'P1_UNITY_BATCH_SUMMARY.json'
$arguments = @('-batchmode', '-nographics', '-quit', '-projectPath', $projectPath, '-logFile', $logPath,
    '-executeMethod', 'Prototype.Editor.SimCliRoundTrip.P1ItemExportCheck.Run', '-p1FormalItemsInput', $formalItemsPath, '-p1ItemsInput', $itemsPath, '-p1ItemsOutput', $resultRoot)
$summary = [ordered]@{
    schemaVersion = 1; status = 'NotRun'; mode = $(if ($Execute) { 'Execute' } else { 'PlanOnly' }); error = ''
    requiredUnityVersion = $requiredVersion; repositoryRoot = $repositoryPath; projectPath = $projectPath
    sourceContentRoot = $sourceRoot; itemsInput = $itemsPath; inputSha256 = ''; sourceFileSha256 = ''; metaSha256 = ''
    formalSourceContentRoot = $formalSourceRoot; formalItemsInput = $formalItemsPath; formalInputSha256 = ''
    executable = $unityExecutable; arguments = $arguments; executableVersion = ''; executableSha256 = ''; projectVersion = ''
    runnerContext = $null; spawnContext = $null; actualCommandLine = ''; processId = $null
    stopRequested = $false; stopContext = $null; stopError = ''; startedAtUtc = ''; completedAtUtc = ''; exitCode = $null
    limits = $null; memoryBefore = $null; memoryAfter = $null; stdout = $null; stderr = $null; semanticComparison = $null; diagnostics = @(); tailGate = $null
}
$editor = $null; $resourceWriter = $null; $stdoutStream = $null; $stderrStream = $null; $stdoutTask = $null; $stderrTask = $null
$scriptExit = 1
try {
    $summary.inputSha256 = Hash-File $itemsPath
    $summary.formalInputSha256 = Hash-File $formalItemsPath
    $editorSource = Join-Path $projectPath 'Assets/Prototype/Editor/SimCliRoundTrip/P1ItemExportCheck.cs'
    $summary.sourceFileSha256 = Hash-File $editorSource
    $summary.metaSha256 = Hash-File ($editorSource + '.meta')
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'items') -PathType Container)) { throw 'SourceContentRoot/items is required.' }
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
    if (-not $Execute) {
        $summary.status = 'Planned'
        $scriptExit = 0
        Write-Host "P1 B8 plan only; Unity was not started. $summaryPath"
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
        if (-not $projectArgument.Success -or (Full-Path $childProject) -ine $projectPath -or $summary.actualCommandLine -notmatch 'Prototype\.Editor\.SimCliRoundTrip\.P1ItemExportCheck\.Run') { throw 'Owned Editor project/method differs from the planned command.' }
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
                Write-Host "[B8] PID=$($editor.Id), $([Math]::Round($seconds))s, CPU=$([Math]::Round($cpu,1))s, WS=$([Math]::Round($editor.WorkingSet64/1GB,2))GiB, log=$length B"
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
        $tailConcerns = @($tailLines | Where-Object { $_ -match '(?i)abort|debugger.*(port|unable|fail|error)|allocator.*(leak|error|fail|unfreed)|unfreed' })
        $summary.tailGate = @{ status = $(if ($tailConcerns.Count) { 'ReviewRequired' } else { 'Clean' }); concerns = $tailConcerns
            rule = 'Unknown mono/debugger/allocator tail diagnostics require root review. This launcher schedules no additional Unity batch.' }
        if ((Hash-File $itemsPath) -cne $summary.inputSha256 -or (Hash-File $formalItemsPath) -cne $summary.formalInputSha256) { throw 'Formal/probe input export changed during Unity read.' }
        $readReport = [IO.File]::ReadAllText((Join-Path $resultRoot 'P1_UNITY_DUAL_READBACK.json')) | ConvertFrom-Json
        if (-not $readReport.readCompleted -or $readReport.processId -ne $editor.Id -or $readReport.unityVersion -cne $requiredVersion -or -not $readReport.batchMode -or $readReport.graphicsDevice -cne 'Null' -or $readReport.cases.Count -ne 2) { throw 'Dual Unity report identity/mode does not match the owned execution.' }
        foreach ($case in $readReport.cases) {
            $expectedHash = if ($case.caseName -ceq 'formal') { $summary.formalInputSha256 } elseif ($case.caseName -ceq 'probe') { $summary.inputSha256 } else { throw 'Unknown Unity readback case.' }
            if (-not $case.readCompleted -or $case.processId -ne $editor.Id -or $case.inputSha256 -cne $expectedHash) { throw 'Formal/probe case does not match the same owned execution/input hash.' }
        }
        Assert-NoEditor (Join-Path $runRoot 'processes-before-comparison.json')
        $nodeExecutable = (Get-Command $NodePath -ErrorAction Stop).Source
        $compareArgs = @((Join-Path $PSScriptRoot 'compare-dual-unity.mjs'), '--formal-items', $formalItemsPath, '--formal-source', $formalSourceRoot, '--probe-items', $itemsPath, '--probe-source', $sourceRoot, '--unity-result', $resultRoot, '--output', (Join-Path $runRoot 'semantic-comparison'))
        $nodeInfo = [Diagnostics.ProcessStartInfo]::new($nodeExecutable); $nodeInfo.UseShellExecute = $false; $nodeInfo.CreateNoWindow = $true
        $nodeInfo.RedirectStandardOutput = $true; $nodeInfo.RedirectStandardError = $true; $nodeInfo.WorkingDirectory = $repositoryPath
        foreach ($argument in $compareArgs) { $nodeInfo.ArgumentList.Add($argument) }
        $node = [Diagnostics.Process]::new(); $node.StartInfo = $nodeInfo; [void]$node.Start()
        $nodeOut = [IO.MemoryStream]::new(); $nodeErr = [IO.MemoryStream]::new()
        $nodeOutTask = $node.StandardOutput.BaseStream.CopyToAsync($nodeOut); $nodeErrTask = $node.StandardError.BaseStream.CopyToAsync($nodeErr)
        $nodeTimedOut = -not $node.WaitForExit(30000)
        if ($nodeTimedOut) { $node.Kill(); $node.WaitForExit() }
        $nodeOutTask.GetAwaiter().GetResult(); $nodeErrTask.GetAwaiter().GetResult()
        [IO.File]::WriteAllBytes((Join-Path $runRoot 'comparison.stdout'), $nodeOut.ToArray()); [IO.File]::WriteAllBytes((Join-Path $runRoot 'comparison.stderr'), $nodeErr.ToArray())
        $summary.semanticComparison = [ordered]@{ executable = $nodeExecutable; arguments = $compareArgs; processId = $node.Id; exitCode = $node.ExitCode; timedOut = $nodeTimedOut
            stdoutSha256 = Hash-File (Join-Path $runRoot 'comparison.stdout'); stderrSha256 = Hash-File (Join-Path $runRoot 'comparison.stderr') }
        $node.Dispose(); $nodeOut.Dispose(); $nodeErr.Dispose()
        if ($nodeTimedOut) { throw 'Owned Node semantic comparison timed out.' }
        if ($summary.semanticComparison.exitCode -ne 0) { throw 'Independent full-field/source-projection comparison failed.' }
        $summary.status = if ($tailConcerns.Count) { 'ReviewRequired' } else { 'Passed' }
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
    foreach ($task in @($stdoutTask, $stderrTask)) { if ($null -ne $task) { try { $task.GetAwaiter().GetResult() } catch { $summary.error += ' Capture error: ' + $_.Exception.Message; $summary.status = 'Failed' } } }
    if ($null -ne $stdoutStream) { $stdoutStream.Dispose() }; if ($null -ne $stderrStream) { $stderrStream.Dispose() }
    if (Test-Path -LiteralPath $stdoutPath) { $summary.stdout = @{ path = $stdoutPath; sha256 = Hash-File $stdoutPath; bytes = (Get-Item -LiteralPath $stdoutPath).Length } }
    if (Test-Path -LiteralPath $stderrPath) { $summary.stderr = @{ path = $stderrPath; sha256 = Hash-File $stderrPath; bytes = (Get-Item -LiteralPath $stderrPath).Length } }
    if ($null -ne $editor -and $editor.HasExited) { $summary.exitCode = $editor.ExitCode }
    try { $summary.memoryAfter = Read-Memory; Write-Json (Join-Path $runRoot 'processes-after.json') @(Read-UnityProcesses) }
    catch { $summary.error += ' Postflight unavailable: ' + $_.Exception.Message; $summary.status = 'Failed'; $scriptExit = 1 }
    if (Test-Path -LiteralPath $logPath) { $summary.diagnostics = @(Select-String -LiteralPath $logPath -Pattern 'mono.*abort|debugger.*port|allocator|Crash!!!|Fatal Error|Received signal|Segmentation fault' | ForEach-Object { @{ line = $_.LineNumber; text = $_.Line } }) }
    $summary.completedAtUtc = [DateTime]::UtcNow.ToString('o')
    if ($summary.status -eq 'Failed') { $scriptExit = 1 }
    Write-Json $summaryPath $summary
    Write-Host "P1 Unity status=$($summary.status); summary=$summaryPath"
    if ($null -ne $editor) { $editor.Dispose() }
}
exit $scriptExit
