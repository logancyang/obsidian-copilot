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

function Find-BundledCodex {
    param([string]$NpmPrefix)

    $candidatePaths = @(
        (Join-Path $NpmPrefix "node_modules\@agentclientprotocol\codex-acp\node_modules\@openai\codex\bin\codex.js"),
        (Join-Path $NpmPrefix "node_modules\@openai\codex\bin\codex.js")
    )
    foreach ($candidate in $candidatePaths) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    throw "The adapter's bundled Codex CLI was not found. Checked: $($candidatePaths -join '; ')"
}

function Test-CodexLoggedIn {
    param(
        [string]$NodeCommand,
        [string]$CodexCommand
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $status = & $NodeCommand $CodexCommand login status 2>&1
        return ($LASTEXITCODE -eq 0 -and (($status -join "`n") -match "Logged in"))
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

if ($env:OS -ne "Windows_NT") {
    throw "Run this installer in native Windows PowerShell, not WSL."
}

$node = Find-NativeCommand -Name "node.exe" -InstallHint "Install Node.js for Windows from https://nodejs.org/, open a new PowerShell window, then run this installer again."
$npm = Find-NativeCommand -Name "npm.cmd" -InstallHint "Install Node.js for Windows from https://nodejs.org/, open a new PowerShell window, then run this installer again."

Write-Step "Checking Windows Node.js"
& $node --version
if ($LASTEXITCODE -ne 0) {
    throw "node.exe could not run successfully."
}
& $npm --version
if ($LASTEXITCODE -ne 0) {
    throw "npm.cmd could not run successfully."
}

Write-Step "Removing the unsupported Codex ACP adapter"
Invoke-Npm -NpmCommand $npm -Arguments @("uninstall", "-g", "@zed-industries/codex-acp")

Write-Step "Installing the supported Codex ACP adapter"
Invoke-Npm -NpmCommand $npm -Arguments @("install", "-g", "@agentclientprotocol/codex-acp")

$prefixOutput = & $npm config get prefix
if ($LASTEXITCODE -ne 0) {
    throw "npm.cmd config get prefix failed with exit code $LASTEXITCODE."
}
$npmPrefix = ([string]($prefixOutput | Select-Object -Last 1)).Trim()
if ([string]::IsNullOrWhiteSpace($npmPrefix)) {
    throw "npm.cmd did not report its global install directory."
}

$packageRoot = Join-Path $npmPrefix "node_modules\@agentclientprotocol\codex-acp"
$metadataPath = Join-Path $packageRoot "package.json"
$adapter = Join-Path $packageRoot "dist\index.js"
if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
    throw "The supported adapter was installed, but package.json was not found at $metadataPath."
}
if (-not (Test-Path -LiteralPath $adapter -PathType Leaf)) {
    throw "The supported adapter was installed, but its entry point was not found at $adapter."
}

$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ($metadata.name -ne "@agentclientprotocol/codex-acp") {
    throw "Unexpected Codex ACP package identity: $($metadata.name)"
}
try {
    $installedVersion = [System.Version]([string]$metadata.version)
} catch {
    throw "Unexpected Codex ACP package version: $($metadata.version)"
}
if ($installedVersion -lt [System.Version]"0.0.38") {
    throw "@agentclientprotocol/codex-acp $installedVersion is not supported. Version 0.0.38 or newer is required."
}

Write-Step "Verifying the supported adapter"
$versionOutput = & $node $adapter --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "codex-acp --version failed with exit code $LASTEXITCODE."
}
$version = (($versionOutput | Out-String).Trim())
if ($version -notmatch "^@agentclientprotocol/codex-acp\s+\d+\.\d+\.\d+(?:[-+]\S+)?$") {
    throw "Unexpected codex-acp identity: $version"
}
Write-Host $version

$hasApiKey = (-not [string]::IsNullOrWhiteSpace($env:CODEX_API_KEY)) -or (-not [string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY))
if ($hasApiKey) {
    Write-Step "Using the existing Codex API key"
} else {
    $codex = Find-BundledCodex -NpmPrefix $npmPrefix
    Write-Step "Checking Codex authentication"
    if (Test-CodexLoggedIn -NodeCommand $node -CodexCommand $codex) {
        Write-Host "Codex is already signed in."
    } else {
        Write-Host "Follow the Codex login prompts. This installer will continue after sign-in finishes."
        & $node $codex login
        if ($LASTEXITCODE -ne 0) {
            throw "Codex login failed with exit code $LASTEXITCODE."
        }
        if (-not (Test-CodexLoggedIn -NodeCommand $node -CodexCommand $codex)) {
            throw "Codex login did not report a signed-in account."
        }
    }
}

try {
    Set-Clipboard -Value $adapter
    $clipboardMessage = "The supported adapter path has been copied to your clipboard."
} catch {
    $clipboardMessage = "Copy this supported adapter path:"
}

Write-Host ""
Write-Host "Done. $clipboardMessage"
Write-Host $adapter
Write-Host ""
Write-Host "Next: Obsidian -> Settings -> Copilot -> Basic -> Agents -> Codex -> Configure -> Auto-detect"
Write-Host "If Auto-detect does not find it, paste the path above into the adapter path field, then select Apply."
