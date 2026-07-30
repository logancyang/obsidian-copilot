Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
    param([string]$Message)

    Write-Host ""
    Write-Host "==> $Message"
}

function Find-NativeCommand {
    param(
        [string]$Name,
        [string]$InstallHint
    )

    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $command -or [string]::IsNullOrWhiteSpace($command.Source)) {
        throw "$Name was not found. $InstallHint"
    }

    return $command.Source
}

function Invoke-Npm {
    param(
        [string]$NpmCommand,
        [string[]]$Arguments
    )

    & $NpmCommand @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm.cmd $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

if ($env:OS -ne "Windows_NT") {
    throw "Run this installer in native Windows PowerShell, not WSL."
}

$node = Find-NativeCommand -Name "node.exe" -InstallHint "Install Node.js for Windows from https://nodejs.org/, then run this installer again."
$npm = Find-NativeCommand -Name "npm.cmd" -InstallHint "Install Node.js for Windows from https://nodejs.org/, then run this installer again."

Write-Step "Checking Windows Node.js"
& $node --version
if ($LASTEXITCODE -ne 0) {
    throw "node.exe could not run successfully."
}
& $npm --version
if ($LASTEXITCODE -ne 0) {
    throw "npm.cmd could not run successfully."
}

Write-Step "Removing the superseded Codex ACP adapter"
Invoke-Npm -NpmCommand $npm -Arguments @("uninstall", "-g", "@zed-industries/codex-acp")

Write-Step "Installing the maintained Codex ACP adapter"
Invoke-Npm -NpmCommand $npm -Arguments @("install", "-g", "@agentclientprotocol/codex-acp")

$prefixOutput = & $npm config get prefix 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "npm.cmd config get prefix failed with exit code $LASTEXITCODE."
}
$npmPrefix = (($prefixOutput | Out-String).Trim())
if ([string]::IsNullOrWhiteSpace($npmPrefix)) {
    throw "npm.cmd did not report its global install directory."
}

$adapter = Join-Path $npmPrefix "codex-acp.cmd"
if (-not (Test-Path -LiteralPath $adapter -PathType Leaf)) {
    throw "The maintained adapter was installed, but codex-acp.cmd was not found at $adapter."
}

Write-Step "Verifying the maintained adapter"
$versionOutput = & $adapter --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "codex-acp.cmd --version failed with exit code $LASTEXITCODE."
}
$version = (($versionOutput | Out-String).Trim())
if ($version -notmatch "^@agentclientprotocol/codex-acp\s+\d+\.\d+\.\d+(?:[-+]\S+)?$") {
    throw "Unexpected codex-acp identity: $version"
}
Write-Host $version

try {
    Set-Clipboard -Value $adapter
    $clipboardMessage = "The codex-acp.cmd path has been copied to your clipboard."
} catch {
    $clipboardMessage = "Copy this codex-acp.cmd path:"
}

Write-Host ""
Write-Host "Done. $clipboardMessage"
Write-Host $adapter
Write-Host ""
Write-Host "Next: Obsidian -> Settings -> Copilot -> Agents -> Codex -> Configure -> Auto-detect"
Write-Host "If Auto-detect does not find it, paste the path above into the binary path field, then save."
