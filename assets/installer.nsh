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
