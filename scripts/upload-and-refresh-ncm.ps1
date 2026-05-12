param(
  [string]$LocalNcmDir = "C:\CloudMusic\VipSongsDownload",
  [string]$RemoteHost = "64.90.20.245",
  [string]$RemoteUser = "root",
  [int]$Port = 2595,
  [string]$RemoteNcmDir = "/opt/music-library/ncm-source",
  [string]$RemoteThemeDir = "/opt/1panel/apps/halo/halo/data/themes/theme-fuwari",
  [string]$RemoteSourceDir = "/opt/music-library/source",
  [string]$RemotePublicDir = "/opt/music-library/public",
  [string]$PublicBase = "/music-library"
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
  param(
    [string]$Title,
    [scriptblock]$Action
  )

  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
  & $Action
}

if (-not (Test-Path -LiteralPath $LocalNcmDir)) {
  throw "Local NCM directory does not exist: $LocalNcmDir"
}

$sshTarget = "$RemoteUser@$RemoteHost"
$localUploadPath = Join-Path $LocalNcmDir "*"

Invoke-Step "Preparing remote directories" {
  ssh -p $Port $sshTarget "mkdir -p '$RemoteNcmDir' '$RemoteSourceDir' '$RemotePublicDir'"
}

Invoke-Step "Uploading local NCM library to $RemoteNcmDir" {
  scp -P $Port -r $localUploadPath "${sshTarget}:$RemoteNcmDir/"
}

Invoke-Step "Converting NCM files on server" {
  ssh -p $Port $sshTarget "cd '$RemoteThemeDir' && node scripts/convert-ncm-library.mjs --input '$RemoteNcmDir' --output '$RemoteSourceDir'"
}

Invoke-Step "Regenerating music library JSON" {
  ssh -p $Port $sshTarget "cd '$RemoteThemeDir' && node scripts/generate-music-library.mjs --input '$RemoteSourceDir' --output '$RemotePublicDir' --public-base '$PublicBase' --skip-existing"
}

Invoke-Step "Checking generated songs.json" {
  ssh -p $Port $sshTarget "ls -lh '$RemotePublicDir/songs.json' && head -c 300 '$RemotePublicDir/songs.json'"
}

Write-Host ""
Write-Host "Done. Music JSON URL: $PublicBase/songs.json" -ForegroundColor Green
