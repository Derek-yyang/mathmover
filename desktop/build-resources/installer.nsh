; 强制按当前用户安装：跳过「为谁安装」自定义页。
;
; 这个页面是 assisted installer 的自定义 PageEx，静默安装（/S）时不会自动跳过，
; 自动更新会因此挂在后台。目录选择页仍由 allowToChangeInstallationDirectory 提供。
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
