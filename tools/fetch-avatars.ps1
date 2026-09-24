# 同步 Instagram 粉丝名单到网站：头像下载 + 内置名单更新 + 可选提交推送
#   tools\fetch-avatars.cmd                          # 双击：自动用 Downloads 里最新的粉丝 CSV，同步并推送
#   tools\fetch-avatars.cmd D:\xx.csv               # 指定 CSV
#   tools\fetch-avatars.cmd D:\xx.csv -NoPush       # 只同步不提交
param(
  [string]$Csv = "",
  [string]$From = "$env:USERPROFILE\Downloads",
  [string]$OutDir = "",
  [string]$RepoRoot = "",
  [switch]$Push,
  [switch]$NoRoster
)
$ErrorActionPreference = "Stop"
$repo = if ($RepoRoot) { $RepoRoot } else { Split-Path -Parent $PSScriptRoot }
if (-not $OutDir) { $OutDir = Join-Path $repo "avatars" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# ---- 1) 找 CSV ----
if (-not $Csv) {
  $cands = @(Get-ChildItem -LiteralPath $From -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "(?i)(follower|following|igfollow)" -and $_.Name -match "(?i)\.csv$" } |
    Sort-Object LastWriteTime -Descending)
  if ($cands.Count -eq 0) { throw "在 $From 里没找到粉丝导出 CSV（文件名含 follower / IGFollow）。也可以直接给路径：fetch-avatars.cmd D:\xx.csv" }
  $Csv = $cands[0].FullName
}
$path = (Resolve-Path -LiteralPath $Csv).Path
Write-Host ("用的 CSV：" + $path) -ForegroundColor Cyan
$rows = @(Import-Csv -LiteralPath $path)
if ($rows.Count -eq 0) { throw "CSV 没有数据行：$path" }
$props = $rows[0].PSObject.Properties.Name
$uCol = $props | Where-Object { $_ -match "^(username|user name)$" } | Select-Object -First 1
$nCol = $props | Where-Object { $_ -match "^(fullname|full name|name)$" } | Select-Object -First 1
$aCol = $props | Where-Object { $_ -match "^(avatar\s*url|avatar|头像)$" } | Select-Object -First 1
$pCol = $props | Where-Object { $_ -match "^(profile\s*url|profile)$" } | Select-Object -First 1
if (-not $uCol) { throw ("找不到 Username 列。现有列：" + ($props -join ", ")) }
if (-not $aCol) { Write-Host "注意：没有 Avatar URL 列 —— 只更新名单，不下载头像" -ForegroundColor Yellow }

# ---- 2) 下载头像（先下临时文件，成功才覆盖；失败绝不动已有文件）----
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
$ok = 0; $fail = @(); $skip = 0
$tmp = Join-Path $env:TEMP ("av_" + [guid]::NewGuid().ToString("N") + ".tmp")
foreach ($r in $rows) {
  $user = ([string]$r.$uCol).Trim()
  $url = if ($aCol) { ([string]$r.$aCol).Trim() } else { "" }
  if (-not $user -or $user -notmatch "^[A-Za-z0-9._-]{1,40}$") { $skip++; continue }
  if (-not $url) { $skip++; continue }
  $out = Join-Path $OutDir ($user + ".jpg")
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UserAgent $ua -Headers @{ Referer = "https://www.instagram.com/" } -UseBasicParsing -TimeoutSec 30
    if ((Get-Item $tmp).Length -lt 500) { throw "too small" }
    Move-Item -LiteralPath $tmp -Destination $out -Force
    $ok++
  } catch { $fail += $user }
}
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }

# JS 字符串转义（自己写，避免 ConvertTo-Json 把 & 变成 \u0026）
function Esc([string]$v) {
  $v = $v -replace "[\r\n]+", ' '
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $v.ToCharArray()) {
    if ($ch -eq '"') { [void]$sb.Append('\"') }
    elseif ($ch -eq '\') { [void]$sb.Append('\\') }
    else { [void]$sb.Append($ch) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

# ---- 3) 更新 index.html 里的内置名单（「载入粉丝名单」按钮用的那份）----
#      按行定位替换，不用跨行正则（避免第二次运行匹配不到的老问题）
$rosterMsg = "未处理"
if (-not $NoRoster) {
  $idx = Join-Path $repo "index.html"
  if (Test-Path -LiteralPath $idx) {
    $pairs = @()
    foreach ($r in $rows) {
      $un = ([string]$r.$uCol).Trim()
      $nm = if ($nCol) { ([string]$r.$nCol).Trim() } else { "" }
      if (-not $nm) { $nm = $un }
      if ($nm -and $un -match "^[A-Za-z0-9._-]{1,40}$") {
        $pairs += ("  [" + (Esc $nm) + ", " + (Esc $un) + "]")
      }
    }
    $lines = [System.IO.File]::ReadAllLines($idx, [System.Text.Encoding]::UTF8)
    $start = -1; $end = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($start -lt 0) { if ($lines[$i] -match "var BUILTIN_ROSTER = \[") { $start = $i } }
      elseif ($lines[$i] -match "^\];\s*$") { $end = $i; break }
    }
    if ($start -lt 0 -or $end -le $start) { $rosterMsg = "没找到内置名单块，跳过" }
    else {
      $newLines = ("var BUILTIN_ROSTER = [`r`n" + ($pairs -join ",`r`n") + "`r`n];") -split "`r`n"
      $all = @()
      if ($start -gt 0) { $all += $lines[0..($start - 1)] }
      $all += $newLines
      if ($end -lt $lines.Count - 1) { $all += $lines[($end + 1)..($lines.Count - 1)] }
      $oldBlock = ($lines[$start..$end] -join "`r`n")
      $newBlock = ($newLines -join "`r`n")
      if ($oldBlock -eq $newBlock) { $rosterMsg = ("内置名单无变化（" + $pairs.Count + " 条）") }
      else {
        [System.IO.File]::WriteAllLines($idx, $all, (New-Object System.Text.UTF8Encoding($false)))
        $rosterMsg = ("内置名单已更新：" + $pairs.Count + " 条")
      }
    }
  } else { $rosterMsg = "找不到 index.html，跳过" }
}

Write-Host ("头像：" + $ok + " 张下载，" + $fail.Count + " 张失败，" + $skip + " 行跳过") -ForegroundColor Green
Write-Host ($rosterMsg) -ForegroundColor Green
if ($deskMsg) { Write-Host $deskMsg -ForegroundColor Green }
if ($fail.Count) { Write-Host ("失败用户：" + ($fail -join ", ")) -ForegroundColor Yellow }

# ---- 3.5) 顺手刷新桌面上的名册 CSV（可直接拖进游戏页导入）----
$deskMsg = "未处理"
$desk = [Environment]::GetFolderPath("Desktop")
if ($desk -and (Test-Path -LiteralPath $desk)) {
  $out = @("Fullname,Username,Avatar URL,Profile URL,Local Avatar")
  foreach ($r in $rows) {
    $un = ([string]$r.$uCol).Trim()
    $nm = if ($nCol) { ([string]$r.$nCol).Trim() } else { "" }
    if (-not $nm) { $nm = $un }
    $av = if ($aCol) { ([string]$r.$aCol).Trim() } else { "" }
    $pf = if ($pCol) { ([string]$r.$pCol).Trim() } else { "" }
    $out += ((Esc $nm) + "," + (Esc $un) + "," + (Esc $av) + "," + (Esc $pf) + "," + (Esc ("avatars/" + $un + ".jpg")))
  }
  $target = Join-Path $desk "avatar-racing-roster.csv"
  [System.IO.File]::WriteAllText($target, (($out -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($true)))
  $deskMsg = ("桌面名册已刷新：" + $target + "（" + ($out.Count - 1) + " 位）")
}

# ---- 4) 提交推送 ----
if ($Push) {
  Push-Location $repo
  git add avatars index.html | Out-Null
  if (-not (git status --porcelain)) { Write-Host "没有变化，无需提交（名单和头像都已是最新）" -ForegroundColor Green }
  else {
    git -c i18n.commitEncoding=utf-8 commit -q -m ("sync followers: " + $ok + " avatars, roster " + $rosterMsg)
    git push origin main
    Write-Host "已提交并推送，GitHub Pages 约 1 分钟后更新" -ForegroundColor Green
  }
  Pop-Location
}