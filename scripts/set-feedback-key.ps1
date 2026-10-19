# Creates the owner key that lets the website save feedback clicks, stores it in Vercel,
# and prints a one-time unlock link. Run from the repo root:  powershell -File scripts/set-feedback-key.ps1
$ErrorActionPreference = "Stop"

$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = ([Convert]::ToBase64String($bytes)).TrimEnd("=").Replace("+", "-").Replace("/", "_")

Push-Location (Join-Path $PSScriptRoot "..\web")
try {
    $null | npx -y vercel@latest env add FEEDBACK_KEY production --value $key --sensitive --force --yes
    # redeploy the current production build so it picks up the key
    $null | npx -y vercel@latest redeploy https://pr-radar-nikhil.vercel.app --target production | Out-Null
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Done. Open this link once on each device you use (keep it private):" -ForegroundColor Green
Write-Host "https://pr-radar-nikhil.vercel.app/#key=$key"
