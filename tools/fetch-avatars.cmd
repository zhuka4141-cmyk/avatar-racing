@echo off
setlocal
rem 双击＝自动用 Downloads 里最新的粉丝 CSV 同步；需要推送时显式加 -Push
rem   fetch-avatars.cmd D:\xx.csv      指定文件
rem   fetch-avatars.cmd D:\xx.csv -NoPush   只同步不提交
rem   fetch-avatars.cmd D:\xx.csv -Push      显式提交并推送
set AUTO=
if "%~1"=="" set AUTO=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fetch-avatars.ps1" %*
set AVATAR_SYNC_EXIT=%ERRORLEVEL%
if defined AUTO pause
exit /b %AVATAR_SYNC_EXIT%
