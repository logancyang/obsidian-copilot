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

Write-Step "Installing Claude Code"
Invoke-RestMethod "https://claude.ai/install.ps1" | Invoke-Expression

$claudeBin = Join-Path $env:USERPROFILE ".local\bin"
$claude = Join-Path $claudeBin "claude.exe"
if (-not (Test-Path -LiteralPath $claude -PathType Leaf)) {
    throw "claude.exe was not found at $claude"
}
Add-PathEntryForThisSession -PathEntry $claudeBin

Write-Step "Signing in to Claude"
Write-Host "Follow the Claude login prompts, then close Claude. This script will continue after Claude exits."
& $claude

try {
    Set-Clipboard -Value $claude
    $clipboardMessage = "The claude.exe path has been copied to your clipboard."
} catch {
    $clipboardMessage = "Copy this claude.exe path:"
}

Write-Host ""
Write-Host "Done. $clipboardMessage"
Write-Host $claude
Write-Host ""
Write-Host "Next: Obsidian -> Settings -> Copilot -> Agent Mode -> Claude -> Configure"
Write-Host "Click Auto-detect. If needed, paste this path into the binary path field, then save."
