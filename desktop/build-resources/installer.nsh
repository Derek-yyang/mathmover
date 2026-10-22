; 强制按当前用户安装：跳过「为谁安装」自定义页。
;
; 这个页面是 assisted installer 的自定义 PageEx，静默安装（/S）时不会自动跳过，
; 自动更新会因此挂在后台。目录选择页仍由 allowToChangeInstallationDirectory 提供。
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER
  !include "nsDialogs.nsh"

  Var mathMoverDesktopShortcutCheckbox
  Var mathMoverCreateDesktopShortcut

  !macro customInit
    StrCpy $mathMoverCreateDesktopShortcut ${BST_CHECKED}
  !macroend

  ; 继续使用 electron-builder 的快捷方式创建和升级逻辑，只补充用户的选择。
  ; 命令行 --no-desktop-shortcut 仍然优先生效。
  !macro _mathMoverIsNoDesktopShortcut _a _b _t _f
    ${StdUtils.TestParameter} $R9 "no-desktop-shortcut"
    ${If} $mathMoverCreateDesktopShortcut == ${BST_UNCHECKED}
      StrCpy $R9 "true"
    ${EndIf}
    StrCmp "$R9" "true" `${_t}` `${_f}`
  !macroend
  !undef isNoDesktopShortcut
  !define isNoDesktopShortcut `"" mathMoverIsNoDesktopShortcut ""`

  !macro customPageAfterChangeDir
    Page custom mathMoverShortcutPage mathMoverShortcutPageLeave

    ; 页面函数在模板注册完插件后再展开，才能使用 StdUtils 检查更新参数。
    Function mathMoverShortcutPage
      ; 自定义页面必须主动跳过静默安装和自动更新，避免后台等待用户操作。
      ${If} ${Silent}
        Abort
      ${EndIf}
      ${If} ${isUpdated}
        Abort
      ${EndIf}

      !insertmacro MUI_HEADER_TEXT "安装选项" "选择安装 MathMover 时需要创建的快捷方式。"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateCheckbox} 0 10u 100% 12u "创建桌面快捷方式"
      Pop $mathMoverDesktopShortcutCheckbox
      ${NSD_SetState} $mathMoverDesktopShortcutCheckbox $mathMoverCreateDesktopShortcut
      nsDialogs::Show
    FunctionEnd

    Function mathMoverShortcutPageLeave
      ${NSD_GetState} $mathMoverDesktopShortcutCheckbox $mathMoverCreateDesktopShortcut
    FunctionEnd
  !macroend
!endif
