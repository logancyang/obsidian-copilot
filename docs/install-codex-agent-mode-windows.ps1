Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message"
}

function Add-PathEntryForThisSession {
    param([string]$PathEntry)

    $needle = $PathEntry.TrimEnd("\")
    foreach ($segment in $env:Path.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries)) {
        if ($segment.TrimEnd("\") -ieq $needle) {
            return
        }
    }

    $env:Path = "$PathEntry;$env:Path"
}

function Find-CodexCommand {
    $candidateBins = @()
    if (-not [string]::IsNullOrWhiteSpace($env:CODEX_INSTALL_DIR)) {
        $candidateBins += $env:CODEX_INSTALL_DIR
    }

    $pathCommand = Get-Command "codex" -ErrorAction SilentlyContinue
    if ($null -ne $pathCommand -and -not [string]::IsNullOrWhiteSpace($pathCommand.Source)) {
        $candidateBins += (Split-Path -Parent $pathCommand.Source)
    }

    $candidateBins += (Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin")
    $candidateBins += (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin")

    $seen = @{}
    $checked = @()
    foreach ($bin in $candidateBins) {
        if ([string]::IsNullOrWhiteSpace($bin)) {
            continue
        }

        $key = $bin.TrimEnd("\").ToLowerInvariant()
        if ($seen.ContainsKey($key)) {
            continue
        }
        $seen[$key] = $true

        $candidate = Join-Path $bin "codex.exe"
        $checked += $candidate
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [PSCustomObject]@{
                Bin  = $bin
                Path = $candidate
            }
        }
    }

    throw "codex.exe was not found. Checked: $($checked -join '; ')"
}

Write-Step "Installing Codex CLI"
$previousNonInteractive = $env:CODEX_NON_INTERACTIVE
$env:CODEX_NON_INTERACTIVE = "1"
try {
    Invoke-RestMethod "https://github.com/openai/codex/releases/latest/download/install.ps1" | Invoke-Expression
} finally {
    if ([string]::IsNullOrWhiteSpace($previousNonInteractive)) {
        Remove-Item Env:\CODEX_NON_INTERACTIVE -ErrorAction SilentlyContinue
    } else {
        $env:CODEX_NON_INTERACTIVE = $previousNonInteractive
    }
}

$resolvedCodex = Find-CodexCommand
$codexBin = $resolvedCodex.Bin
$codex = $resolvedCodex.Path
Add-PathEntryForThisSession -PathEntry $codexBin

Write-Step "Signing in to Codex"
Write-Host "Follow the Codex login prompts. This script will continue after login finishes."
& $codex login

Write-Step "Installing codex-acp"
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") {
    "aarch64"
} else {
    "x86_64"
}
$acpDir = Join-Path $env:LOCALAPPDATA "Programs\codex-acp"
$zip = Join-Path $env:TEMP "codex-acp.zip"

$release = Invoke-RestMethod "https://api.github.com/repos/zed-industries/codex-acp/releases/latest"
$asset = $release.assets |
    Where-Object { $_.name -like "codex-acp-*-$arch-pc-windows-msvc.zip" } |
    Select-Object -First 1

if ($null -eq $asset) {
    throw "No codex-acp Windows release was found for $arch."
}

New-Item -ItemType Directory -Force -Path $acpDir | Out-Null
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $acpDir -Force

$acp = Join-Path $acpDir "codex-acp.exe"
if (-not (Test-Path -LiteralPath $acp -PathType Leaf)) {
    throw "codex-acp.exe was not found at $acp"
}

try {
    Set-Clipboard -Value $acp
    $clipboardMessage = "The codex-acp.exe path has been copied to your clipboard."
} catch {
    $clipboardMessage = "Copy this codex-acp.exe path:"
}

Write-Host ""
Write-Host "Done. $clipboardMessage"
Write-Host $acp
Write-Host ""
Write-Host "Next: Obsidian -> Settings -> Copilot -> Agent Mode -> Codex -> Configure"
Write-Host "Paste this path into the binary path field, leave Environment variables empty, then save."
