param(
  [string]$BuildId = 'b8374c3d-6764-4f06-9908-e84240fb4bd1',
  [string]$Tag = 'v1.0.0',
  [switch]$CreateRelease
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$artifactDirectory = Join-Path $projectRoot 'release-artifacts'
$downloadPath = Join-Path $artifactDirectory 'eas-build.apk'
$assetPath = Join-Path $artifactDirectory 'NavDiret-v1.0.0.apk'

New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
if (Test-Path -LiteralPath $downloadPath) { throw "Staging file already exists: $downloadPath. Move it aside before downloading." }
if (Test-Path -LiteralPath $assetPath) { throw "Release asset already exists: $assetPath. Move it aside before downloading." }

Write-Host "Downloading Android build $BuildId from EAS..."
& npx --yes eas-cli@latest build:download --build-id $BuildId --path $downloadPath
if ($LASTEXITCODE -ne 0) { throw "EAS download failed with exit code $LASTEXITCODE." }
if (-not (Test-Path -LiteralPath $downloadPath)) { throw 'EAS did not produce the expected APK file. Confirm that this build ID is a completed Android APK build.' }

$apk = Get-Item -LiteralPath $downloadPath
if ($apk.Length -lt 1) { throw 'The downloaded APK is empty.' }
Move-Item -LiteralPath $downloadPath -Destination $assetPath
Write-Host "APK ready: $assetPath"
Get-FileHash -LiteralPath $assetPath -Algorithm SHA256 | Format-List

if (-not $CreateRelease) {
  Write-Host 'Download complete. Review the APK, then create or push the v1.0.0 tag before publishing.'
  Write-Host "gh release create $Tag `"$assetPath#NavDiret-v1.0.0.apk`" --title 'NavDiret v1.0.0 - Initial Public Preview' --notes-file `"$(Join-Path $projectRoot 'RELEASE_NOTES.md')`" --verify-tag"
  exit 0
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is not installed.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'RELEASE_NOTES.md'))) { throw 'RELEASE_NOTES.md is missing.' }
Push-Location $projectRoot
try {
  $dirty = git status --porcelain
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Git status.' }
  if ($dirty) { throw 'Git working tree is not clean. Commit or stash changes before creating a release.' }
  git show-ref --verify --quiet "refs/tags/$Tag"
  if ($LASTEXITCODE -ne 0) { throw "Local tag $Tag is missing. Create and push the reviewed release tag before publishing." }
  gh auth status
  if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is not authenticated.' }
  gh release create $Tag "$assetPath#NavDiret-v1.0.0.apk" --title 'NavDiret v1.0.0 - Initial Public Preview' --notes-file (Join-Path $projectRoot 'RELEASE_NOTES.md') --verify-tag
  if ($LASTEXITCODE -ne 0) { throw "GitHub release creation failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
