Windows x64 与 macOS Apple 芯片安装包。

- 设置页加入版本显示，更新「关于」页面和应用内关于弹窗；外观入口改用更清晰的深浅主题图标。
- 思考档位改为可直接点击的分段选择器，可用档位在独立浮层中配置，与对话输入区同步。
- 修复保存模型 API 配置后仍显示未登录、保存时触发整轮 Agent 检测的问题。没有修改时禁用保存按钮，密钥提示和保存反馈也更简洁。
- 减少切换归档课件时加载占位的闪动。
- 数据与存储页支持复制数据路径、在桌面端打开数据或备份文件夹，并显示备份完成时间。
- 帮助页增加快捷键速查和可折叠的使用说明，展开与收起加入平滑动画，并适配减少动态效果偏好。
- Windows 和 Mac 的更新事件与错误写入 `logs/updater.log`，便于排查自动更新问题。

- Windows：下载 `MathMover-Setup.exe`。
- macOS 12+ Apple 芯片：下载 `MathMover-mac-arm64.dmg`，打开后把 MathMover 拖到「应用程序」。Intel Mac 暂不支持。

Mac 版尚未经过 Developer ID 签名和 Apple 公证。首次打开如提示「Apple 无法验证」，请在确认安装包来自本仓库后，前往「系统设置 → 隐私与安全性 → 仍要打开」。[首次安装图文说明](https://github.com/Derek-yyang/mathmover/blob/master/docs/macos-install.md)。

**已安装 Mac 0.0.4 或更早版本的用户，需要手动安装一次本版，以启用后续自动更新。** 课件与设置会保留。

首次使用请在设置中连接自己的模型 API，或选择本机已安装并登录的 Agent。
