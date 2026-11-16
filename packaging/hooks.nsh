; Run by the installer before it copies files (and before it uninstalls): end whatever is still running from the
; install folder. Scrifts leaves its backend and the FontForge worker behind when the installer closes the app
; abruptly, and Windows will not overwrite a file that is in use.
!macro StopScrifts
  nsExec::Exec `powershell -NoProfile -WindowStyle Hidden -Command "Get-Process | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Sleep 800
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro StopScrifts
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro StopScrifts
!macroend
