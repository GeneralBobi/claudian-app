!macro customHeader
  ManifestDPIAware true
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\install-language.txt" w
  FileWrite $0 "$LANGUAGE"
  FileClose $0
  System::Call 'kernel32::GetTickCount64() l .r1'
  FileOpen $0 "$INSTDIR\install-session.txt" w
  FileWrite $0 "$1"
  FileClose $0
!macroend

; Removing the program used to leave every file it had written inside the user's AI
; applications, plus its own profile. The next install then resumed that profile, skipped the
; setup wizard and pointed at a notes folder that no longer existed. The application withdraws
; its own connections here, the same way the panel withdraws one; notes are never touched.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DetailPrint "Removing Claudian connections from your AI applications..."
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --purge' $0
    ${if} $0 != 0
      DetailPrint "Some connections could not be removed automatically. Open the AI application's settings to check."
    ${endif}
  ${endIf}
!macroend
