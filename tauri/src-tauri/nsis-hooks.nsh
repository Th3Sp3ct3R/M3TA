!macro NSIS_HOOK_PREINSTALL
  ; Free the files the updater must overwrite. The running app, the node daemon /
  ; Telegram bridge it spawned, AND any GHOST node left orphaned by a previous
  ; run all hold Ares.exe and the bundled node.exe open — which made in-app
  ; updates die with "Error opening file for writing … node.exe" (retry/ignore/
  ; abort). Kill the app (no /T — the updater itself may be a child of Ares.exe
  ; and we must not kill it), then every node.exe whose image lives under THIS
  ; install dir (never the user's unrelated node), then WAIT until the file is
  ; actually writable before the copy step begins.
  ;
  ; We match on CIM's ExecutablePath, not Get-Process().Path: the latter returns
  ; $null for processes whose main-module path Windows won't hand back, so the
  ; old filter silently skipped the very node.exe holding the lock. CIM is
  ; reliable for the current user's own processes.
  nsExec::ExecToLog 'taskkill /F /IM Ares.exe'
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'node.exe' -and $$_.ExecutablePath -like '$INSTDIR*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  ; Block until node.exe can be opened for exclusive write (handles released),
  ; up to ~8s — so NSIS never races the OS and hits 'file in use'.
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$f = Join-Path '$INSTDIR' 'runtime\bin\node.exe'; for ($$i = 0; $$i -lt 16; $$i++) { if (-not (Test-Path $$f)) { break }; try { $$s = [System.IO.File]::Open($$f, 'Open', 'ReadWrite', 'None'); $$s.Close(); break } catch { Start-Sleep -Milliseconds 500 } }"`
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetShellVarContext current
  CreateShortCut "$DESKTOP\Ares.lnk" "$INSTDIR\Ares.exe"
  ; Register the `ares` CLI on the user's PATH using the bundled self-contained
  ; runtime, so `ares` works in PowerShell/cmd right after install.
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\register-cli.ps1" -InstallDir "$INSTDIR"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  SetShellVarContext current
  Delete "$DESKTOP\Ares.lnk"
  ; Remove the `ares` PATH shim (leaves ~/.ares config + vault intact).
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\unregister-cli.ps1"'
!macroend
