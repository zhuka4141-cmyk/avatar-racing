@echo off
rem 双击＝自动用 Downloads 里最新的粉丝 CSV 同步并推送；也可带参数
rem   fetch-avatars.cmd D:\xx.csv      指定文件
rem   fetch-avatars.cmd D:\xx.csv -NoPush   只同步不提交
set AUTO=
if "%~1"=="" set AUTO=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fetch-avatars.ps1" %* -Push
if defined AUTO pause
