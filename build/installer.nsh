; Extra NSIS steps for the Suno Desktop installer (included by electron-builder).

!macro customInstall
  ; Register suno-desktop:// so deep links work before the first launch.
  WriteRegStr SHCTX "Software\Classes\suno-desktop" "" "URL:Suno Desktop"
  WriteRegStr SHCTX "Software\Classes\suno-desktop" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\suno-desktop\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\suno-desktop\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ; Updates run the old uninstaller first; keep registrations in that case.
  ${ifNot} ${isUpdated}
    DeleteRegKey SHCTX "Software\Classes\suno-desktop"
    DeleteRegKey HKCU "Software\Classes\suno-desktop"
    ; "Launch on startup" entry written by app.setLoginItemSettings.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.catthings.sunodesktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.catthings.sunodesktop"
  ${endIf}
!macroend
