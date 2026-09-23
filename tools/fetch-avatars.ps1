# 下载粉丝头像到 avatars/（文件名 = 用户名），可用 -Push 直接提交推送
#   .\tools\fetch-avatars.cmd .\IGFollow_xxx.csv           # 只下载
#   .\tools\fetch-avatars.cmd .\IGFollow_xxx.csv -Push     # 下载 + commit + push（线上自动更新）
param(
  [Parameter(Mandatory=$true)][string]$Csv,
  [string]$OutDir = "",
  [switch]$Push
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $repo "avatars" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$path = (Resolve-Path -LiteralPath $Csv).Path
$rows = @(Import-Csv -LiteralPath $path)
if ($rows.Count -eq 0) { throw "CSV has no data rows: $path" }
$props = $rows[0].PSObject.Properties.Name
$uCol = $props | Where-Object { $_ -match "^(username|user name)$" } | Select-Object -First 1
$aCol = $props | Where-Object { $_ -match "^(avatar\s*url|avatar)$" } | Select-Object -First 1
if (-not $uCol) { throw "No Username column. Columns: $($props -join ", ")" }
if (-not $aCol) { throw "No Avatar URL column. Columns: $($props -join ", ")" }
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
$ok = 0; $fail = @(); $skip = 0
foreach ($r in $rows) {
  $user = ([string]$r.$uCol).Trim(); $url = ([string]$r.$aCol).Trim()
  if (-not $user -or $user -notmatch "^[A-Za-z0-9._-]{1,40}$") { $skip++; continue }
  $out = Join-Path $OutDir ($user + ".jpg")
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UserAgent $ua -Headers @{ Referer = "https://www.instagram.com/" } -UseBasicParsing -TimeoutSec 30
    if ((Get-Item $out).Length -lt 500) { throw "file too small" }
    $ok++
  } catch {
    $fail += $user
    if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
  }
}
Write-Host ("Done: " + $ok + " ok, " + $fail.Count + " failed, " + $skip + " skipped") -ForegroundColor Green
if ($fail.Count) { Write-Host ("Failed users: " + ($fail -join ", ")) -ForegroundColor Yellow }
if ($Push) {
  Push-Location $repo
  git add avatars
  git -c i18n.commitEncoding=utf-8 commit -m ("update avatars: " + $ok + " follower avatars")
  git push origin main
  Pop-Location
  Write-Host "Committed and pushed. GitHub Pages updates in about 1 minute." -ForegroundColor Green
}