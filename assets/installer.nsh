!macro customHeader
  ManifestDPIAware true
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\install-language.txt" w
  FileWrite $0 "$LANGUAGE"
  FileClose $0
!macroend
