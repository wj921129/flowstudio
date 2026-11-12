@echo off
setlocal
title FlowStudio - Stop
cd /d "%~dp0\.."

echo ========================================================
echo   FlowStudio - Stop
echo ========================================================

powershell -NoProfile -Command "$root=(Get-Location).Path; $targets=@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -and ($_.CommandLine -like ('*'+$root+'*') -or $_.CommandLine -like '*packages*server*dist*index.js*')) -or ($_.Name -eq 'cmd.exe' -and $_.CommandLine -and ($_.CommandLine -like ('*'+$root+'*start.bat*') -or $_.CommandLine -like '*scripts*start.bat*' -or $_.CommandLine -like '*pnpm dev*')) }); if(-not $targets){ Write-Host 'No running FlowStudio processes found.'; exit 0 }; Write-Host 'Found FlowStudio processes:'; foreach($t in $targets){ $p=''; if($t.Name -eq 'node.exe'){ $p=(Get-NetTCPConnection -State Listen -OwningProcess $t.ProcessId -ErrorAction SilentlyContinue).LocalPort -join ',' }; $c=$t.CommandLine; if($c.Length -gt 110){ $c=$c.Substring(0,110)+'...' }; Write-Host ('  PID {0}  [{1}]  port[{2}]  {3}' -f $t.ProcessId,$t.Name,$p,$c) }; $ans=Read-Host 'Stop all listed processes? (y/N)'; if($ans -ne 'y' -and $ans -ne 'Y'){ Write-Host 'Cancelled.'; exit 0 }; foreach($t in $targets){ Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 300; $left=@($targets | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }); if($left){ Write-Host ('Warning: failed to stop PID(s): '+($left.ProcessId -join ',')) } else { Write-Host 'FlowStudio stopped.' }"

if %errorlevel% neq 0 echo [Error] Stop script failed.
pause