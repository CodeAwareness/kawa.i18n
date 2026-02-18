# Create a directory junction so Muninn loads the i18n extension from this repo.
# Run from the kawa.i18n repo root. Requires no admin.
# Usage: .\link-extension-i18n.ps1 [-Target "C:\path\to\kawa.i18n"]
# If -Target is omitted, uses the directory containing this script.

param(
    [string]$Target = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$extDir = Join-Path $env:USERPROFILE ".kawa-code\extensions"
$linkPath = Join-Path $extDir "kawa.i18n"

if (-not (Test-Path $Target)) {
    Write-Error "Target not found: $Target. Set -Target to your kawa.i18n repo path."
    exit 1
}

if (-not (Test-Path $extDir)) {
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
    Write-Host "Created $extDir"
}

if (Test-Path $linkPath) {
    $item = Get-Item $linkPath -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Write-Host "Already a link: $linkPath -> $($item.Target)"
        exit 0
    }
    $bak = "${linkPath}.bak"
    if (Test-Path $bak) { Remove-Item $bak -Recurse -Force }
    Rename-Item $linkPath $bak
    Write-Host "Renamed existing folder to $bak"
}

New-Item -ItemType Junction -Path $linkPath -Target $Target | Out-Null
Write-Host "Created junction: $linkPath -> $Target"
Write-Host "Muninn will load the i18n extension from your repo."
