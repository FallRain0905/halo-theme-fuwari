param(
  [string]$LocalNcmDir = "C:\CloudMusic\VipSongsDownload",
  [string]$RemoteHost = "64.90.20.245",
  [string]$RemoteUser = "root",
  [int]$Port = 2595,
  [string]$RemoteNcmDir = "/opt/music-library/ncm-source",
  [string]$RemoteThemeDir = "/opt/1panel/apps/halo/halo/data/themes/theme-fuwari",
  [string]$RemoteSourceDir = "/opt/music-library/source",
  [string]$RemotePublicDir = "/opt/music-library/public",
  [string]$PublicBase = "/music-library",
  [string]$Section = "",
  [int]$CategoryDepth = 1,
  [string]$MusicApiToken = "",
  [string]$MusicApiSyncUrl = "http://127.0.0.1:3100/sync",
  [switch]$CleanSource,
  [switch]$CleanPublic,
  [switch]$RemoveRemoteUploadAfterConvert,
  [switch]$SkipApiSync
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
$remoteUploadDir = $RemoteNcmDir.TrimEnd("/")
if (-not [string]::IsNullOrWhiteSpace($Section)) {
  $safeSection = $Section.Trim().Trim("/")
  if ($safeSection -match "['`"]") {
    throw "Section cannot contain quotes: $Section"
  }
  $remoteUploadDir = "$remoteUploadDir/$safeSection"
}

Invoke-Step "Preparing remote directories" {
  ssh -p $Port $sshTarget "mkdir -p '$remoteUploadDir' '$RemoteSourceDir' '$RemotePublicDir'"
}

if ($CleanSource) {
  Invoke-Step "Cleaning converted source directory" {
    ssh -p $Port $sshTarget "rm -rf '$RemoteSourceDir' && mkdir -p '$RemoteSourceDir'"
  }
}

if ($CleanPublic) {
  Invoke-Step "Cleaning public music library directory" {
    ssh -p $Port $sshTarget "rm -rf '$RemotePublicDir' && mkdir -p '$RemotePublicDir'"
  }
}

Invoke-Step "Uploading local audio library to $remoteUploadDir" {
  scp -P $Port -r $localUploadPath "${sshTarget}:$remoteUploadDir/"
}

Invoke-Step "Converting NCM files and copying plain audio on server" {
  $skipConvertFlag = if ($CleanSource) { "" } else { "--skip-existing" }
  ssh -p $Port $sshTarget "cd '$RemoteThemeDir' && node scripts/convert-ncm-library.mjs --input '$RemoteNcmDir' --output '$RemoteSourceDir' $skipConvertFlag"
}

if ($RemoveRemoteUploadAfterConvert) {
  Invoke-Step "Removing uploaded source files from $remoteUploadDir" {
    ssh -p $Port $sshTarget "rm -rf '$remoteUploadDir'"
  }
}

Invoke-Step "Regenerating music library JSON" {
  $cleanFlag = if ($CleanPublic) { "--clean" } else { "--skip-existing" }
  ssh -p $Port $sshTarget "cd '$RemoteThemeDir' && node scripts/generate-music-library.mjs --input '$RemoteSourceDir' --output '$RemotePublicDir' --public-base '$PublicBase' --category-depth $CategoryDepth $cleanFlag"
}

if (-not $SkipApiSync) {
  if ([string]::IsNullOrWhiteSpace($MusicApiToken)) {
    Write-Host ""
    Write-Host "Skipping Music API sync because -MusicApiToken was not provided." -ForegroundColor Yellow
    Write-Host "Run with -MusicApiToken 'your-token' to refresh the SQLite database automatically." -ForegroundColor Yellow
  } else {
    Invoke-Step "Syncing Music API database" {
      if ($MusicApiToken -match "['`"]") {
        throw "MusicApiToken cannot contain quotes."
      }
      ssh -p $Port $sshTarget "curl -fsS -X POST -H 'Authorization: Bearer $MusicApiToken' '$MusicApiSyncUrl'"
    }
  }
}

Invoke-Step "Checking generated songs.json" {
  ssh -p $Port $sshTarget "ls -lh '$RemotePublicDir/songs.json' && head -c 300 '$RemotePublicDir/songs.json'"
}

Write-Host ""
Write-Host "Done. Music JSON URL: $PublicBase/songs.json" -ForegroundColor Green
