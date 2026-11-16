param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$Dotnet = 'dotnet'
)
# PowerShell 7. Every process keeps separate unedited stdout, stderr, arguments and exit code.
$ErrorActionPreference = 'Stop'
$simRoot = Split-Path -Parent $PSScriptRoot
$repository = Split-Path -Parent (Split-Path -Parent $simRoot)
$destination = [IO.Path]::GetFullPath($OutputDirectory)
[void][IO.Directory]::CreateDirectory($destination)
$utf8 = [Text.UTF8Encoding]::new($false)
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:DOTNET_CLI_UI_LANGUAGE = 'en'

function Invoke-Recorded([string]$Name, [string]$Executable, [string[]]$Arguments) {
    $info = [Diagnostics.ProcessStartInfo]::new($Executable)
    $info.WorkingDirectory = $simRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = $utf8
    $info.StandardErrorEncoding = $utf8
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $exited = $process.WaitForExit(600000)
    if (-not $exited) { $process.Kill($true); $process.WaitForExit() }
    $text = $stdout.GetAwaiter().GetResult()
    $errorText = $stderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText((Join-Path $destination "$Name.stdout"), $text, $utf8)
    [IO.File]::WriteAllText((Join-Path $destination "$Name.stderr"), $errorText, $utf8)
    $receipt = [ordered]@{ executable=$Executable; arguments=$Arguments; workingDirectory=$simRoot; exitCode=$process.ExitCode; timedOut=(-not $exited) }
    [IO.File]::WriteAllText((Join-Path $destination "$Name.command.json"), ($receipt | ConvertTo-Json -Depth 10) + "`n", $utf8)
    Write-Host $text
    if ($errorText) { Write-Host $errorText }
    if (-not $exited -or $process.ExitCode -ne 0) { throw "$Name failed: exit $($process.ExitCode), timedOut=$(-not $exited). See preserved output." }
    return $text
}

$versionOutput = Invoke-Recorded 'sdk-version' $Dotnet @('--version')
if (($versionOutput | Select-Object -Last 1).Trim() -ne '8.0.428') { throw 'The formal P0 run requires the exact pinned SDK 8.0.428.' }
[void](Invoke-Recorded 'sdk-info' $Dotnet @('--info'))
$sourceCommitOutput = Invoke-Recorded 'source-commit' 'git' @('-c', ('safe.directory=' + $repository.Replace('\', '/')), 'rev-parse', 'HEAD')
$sourceCommit = ($sourceCommitOutput | Select-Object -Last 1).Trim()
$identity = [ordered]@{
    os=[Runtime.InteropServices.RuntimeInformation]::OSDescription
    architecture=[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    framework=[Runtime.InteropServices.RuntimeInformation]::FrameworkDescription
    user=[Environment]::UserName
    githubRunId=$env:GITHUB_RUN_ID
    githubEventSha=$env:GITHUB_SHA
    expectedSourceCommit=$env:P0_EXPECTED_COMMIT
    actualSourceCommit=$sourceCommit
    githubHeadRef=$env:GITHUB_HEAD_REF
    githubRef=$env:GITHUB_REF
}
[IO.File]::WriteAllText((Join-Path $destination 'environment.json'), ($identity | ConvertTo-Json) + "`n", $utf8)
if ($env:P0_EXPECTED_COMMIT -and $sourceCommit -cne $env:P0_EXPECTED_COMMIT) { throw 'Actual checkout HEAD differs from the expected PR head commit.' }
[void](Invoke-Recorded 'formal-build' $Dotnet @('build', '.', '-c', 'Release', '-warnaserror', '--no-incremental', '-m:1', "-bl:$(Join-Path $destination 'formal-build.binlog')"))
foreach ($module in @('Combat', 'BaseEconomy', 'Tactics', 'Expedition')) {
    $project = "src/Prototype.$module/Prototype.$module.csproj"
    $metadataText = Invoke-Recorded "project-$module" $Dotnet @('msbuild', $project, '-getProperty:TargetFramework,LangVersion,Nullable,ImplicitUsings,TreatWarningsAsErrors', '-getItem:Compile,ProjectReference')
    $metadata = $metadataText | ConvertFrom-Json
    if ($metadata.Properties.TargetFramework -ne 'netstandard2.1' -or $metadata.Properties.LangVersion -ne '9.0' -or $metadata.Properties.Nullable -ne 'disable' -or $metadata.Properties.ImplicitUsings -ne 'disable' -or $metadata.Properties.TreatWarningsAsErrors -ne 'true') { throw "Runtime project restrictions differ: $module" }
    $runtimeDirectory = [IO.Path]::GetFullPath((Join-Path $repository "Game/Assets/Prototype/$module/Runtime")) + [IO.Path]::DirectorySeparatorChar
    foreach ($compile in $metadata.Items.Compile) {
        if (-not $compile.FullPath.StartsWith($runtimeDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw "Non-linked Runtime source: $($compile.FullPath)" }
    }
    $expectedReferences = switch ($module) { 'Tactics' { @('Prototype.Combat') } 'Expedition' { @('Prototype.Combat', 'Prototype.BaseEconomy') } default { @() } }
    $actualReferences = @($metadata.Items.ProjectReference | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.FullPath) })
    if ((@($expectedReferences | Sort-Object) -join ',') -cne (@($actualReferences | Sort-Object) -join ',')) { throw "Runtime references differ from asmdef: $module" }
}
[void](Invoke-Recorded 'verification-build' $Dotnet @('build', 'verification', '-c', 'Release', '-warnaserror', '-m:1'))
$verificationOutput = Join-Path $destination 'pure'
[void](Invoke-Recorded 'pure-verification' $Dotnet @((Join-Path $PSScriptRoot 'bin/Release/net8.0/MyGame.Sim.Verification.dll'), $verificationOutput))
$scriptOutput = Join-Path $destination 'reports-generator'
$pwsh = (Get-Process -Id $PID).Path
[void](Invoke-Recorded 'original-round4-generator' $pwsh @('-NoProfile', '-File', (Join-Path $repository 'Game/Assets/Prototype/Combat/Reports/GenerateRound4Reports.ps1'), '-OutputDirectory', $scriptOutput))
$expected = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'expected-round4-sha256.json') -Raw | ConvertFrom-Json -AsHashtable
$rows = foreach ($name in ($expected.Keys | Sort-Object)) {
    $cliPath = Join-Path $verificationOutput "reports-cli/$name"
    $scriptPath = Join-Path $scriptOutput $name
    $cliHash = (Get-FileHash -LiteralPath $cliPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $scriptHash = (Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [ordered]@{ name=$name; cliSha256=$cliHash; unmodifiedGeneratorSha256=$scriptHash; byteEqual=($cliHash -ceq $scriptHash); frozenWindowsHistoricalSha256=$expected[$name]; equalsFrozenWindowsHistorical=($cliHash -ceq $expected[$name]) }
}
$equal = @($rows | Where-Object { -not $_.byteEqual }).Count -eq 0
$summary = [ordered]@{ ok=$equal; platform=[Runtime.InteropServices.RuntimeInformation]::OSDescription; count=@($rows).Count; reports=$rows }
[IO.File]::WriteAllText((Join-Path $destination 'report-hash-comparison.json'), ($summary | ConvertTo-Json -Depth 10) + "`n", $utf8)
if (-not $equal -or @($rows).Count -ne 10) { throw 'A5: CLI and unmodified original generator report bytes differ.' }
Write-Output "P0 pure .NET checks passed. Evidence: $destination"
