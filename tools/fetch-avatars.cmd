@echo off
rem 用法： fetch-avatars.cmd <粉丝CSV路径> [-Push]
rem   -Push 会顺便 git commit + push（线上自动更新）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fetch-avatars.ps1" %*
