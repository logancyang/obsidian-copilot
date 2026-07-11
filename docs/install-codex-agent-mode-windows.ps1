Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message"
}

function Get-RequiredCommand {
    param(
        [string]$Name,
        [string]$InstallHint
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command -or [string]::IsNullOrWhiteSpace($command.Source)) {
        throw "$Name was not found. $InstallHint"
    }
    return $command.Source
}

Write-Step "Checking Node.js and npm"
$node = Get-RequiredCommand -Name "node.exe" -InstallHint "Install the current Node.js LTS release from https://nodejs.org/, reopen PowerShell, and run this installer again."
$npm = Get-RequiredCommand -Name "npm.cmd" -InstallHint "Install the current Node.js LTS release from https://nodejs.org/, reopen PowerShell, and run this installer again."

& $node --version
if ($LASTEXITCODE -ne 0) {
    throw "Node.js could not be started. Reinstall the current Node.js LTS release and try again."
}

& $npm --version
if ($LASTEXITCODE -ne 0) {
    throw "npm could not be started. Reinstall the current Node.js LTS release and try again."
}

Write-Step "Removing the superseded Codex adapter, if present"
& $npm uninstall -g "@zed-industries/codex-acp"
if ($LASTEXITCODE -ne 0) {
    throw "npm could not remove @zed-industries/codex-acp. Fix the npm error above, then run this installer again."
}

Write-Step "Installing the maintained Codex adapter"
& $npm install -g "@agentclientprotocol/codex-acp"
if ($LASTEXITCODE -ne 0) {
    throw "npm could not install @agentclientprotocol/codex-acp. Fix the npm error above, then run this installer again."
}

$npmRootLines = @(& $npm root -g)
if ($LASTEXITCODE -ne 0) {
    throw "npm could not report its global package folder."
}
$npmRoot = $npmRootLines |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Last 1
if ([string]::IsNullOrWhiteSpace($npmRoot)) {
    throw "npm returned an empty global package folder."
}

$adapter = Join-Path ($npmRoot.Trim()) "@agentclientprotocol\codex-acp\dist\index.js"
if (-not (Test-Path -LiteralPath $adapter -PathType Leaf)) {
    throw "The Codex adapter entry was not found at $adapter"
}

Write-Step "Checking the installed adapter"
& $node $adapter --version
if ($LASTEXITCODE -ne 0) {
    throw "The installed Codex adapter could not be started with Node.js."
}
& $node $adapter cli --version
if ($LASTEXITCODE -ne 0) {
    throw "The adapter's bundled Codex CLI could not be started."
}

try {
    Set-Clipboard -Value $adapter
    $clipboardMessage = "The adapter path has been copied to your clipboard."
} catch {
    $clipboardMessage = "Copy this adapter path:"
}

Write-Host ""
Write-Host "Done. $clipboardMessage"
Write-Host $adapter
Write-Host ""
Write-Host "Next: Obsidian -> Settings -> Copilot -> Agents -> Codex -> Configure"
Write-Host "Click Auto-detect. If needed, paste the path above into the binary path field, leave Environment variables empty, then save."
Write-Host "Copilot will offer Codex sign-in when authentication is needed. A separate global Codex CLI is not required."
