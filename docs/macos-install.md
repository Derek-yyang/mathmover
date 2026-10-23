# 在 Mac 上安装 MathMover

适用于 **Apple 芯片 Mac（M 系列）**，暂不支持 Intel Mac。可从苹果菜单的「关于本机」查看芯片型号。

## 下载与安装

1. [下载最新版 DMG](https://github.com/Derek-yyang/mathmover/releases/latest/download/MathMover-mac-arm64.dmg)。也可以在 [Releases](https://github.com/Derek-yyang/mathmover/releases/latest) 中选择文件名包含 `mac-arm64.dmg` 的安装包。
2. 双击打开 DMG，把 **MathMover 拖到「应用程序」文件夹**。
3. 从「应用程序」打开 MathMover。安装完成后可以推出 DMG 磁盘映像。

发布页还提供 ZIP，它是同一个应用的压缩包；一般使用 DMG 即可，不需要两个都下载。

## 首次打开时提示「Apple 无法验证」

当前 Mac 版采用本地签名，尚未经过 Developer ID 签名和 Apple 公证，因此首次打开可能出现这个提示。

确认安装包来自本项目的 GitHub Releases 后：

1. 在提示中选择「完成」，先不要把应用移到废纸篓。
2. 打开 **系统设置 → 隐私与安全性**，向下滚动到「安全性」。
3. 找到 MathMover 的阻止提示，点击 **仍要打开**，按系统提示确认。必要时输入 Mac 登录密码或使用 Touch ID。
4. 回到应用，填写自己的模型配置并保存，即可使用。

![macOS「隐私与安全性」中用于批准打开应用的「仍要打开」按钮](https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/locale/zh-cn/macos-sequoia-system-settings-privacy-and-security-open-app-anyway.png)

上图来自 [Apple 官方操作说明](https://support.apple.com/zh-cn/102445)，不同 macOS 版本的界面可能略有区别。若没有出现「仍要打开」，先从「应用程序」尝试打开 MathMover 一次，再回到这里查看。

系统会记住这次批准，之后通常可以直接双击打开。无需关闭整个系统的安全检查。受学校或公司管理的 Mac 可能限制此操作，需要联系管理员。

若提示「将损坏你的电脑」或「应用已损坏」，请停止打开，重新从本项目 Releases 下载，并通过 [Issues](https://github.com/Derek-yyang/mathmover/issues) 反馈；这些提示不能按普通的首次打开提醒处理。

## 更新到新版本

MathMover 启动后会检查新版；也可以从菜单栏、应用标题栏菜单或托盘菜单中选择 **检查更新…**。

1. 出现新版提醒后，点击「下载新版」。
2. 下载完成后，通过 MathMover 菜单选择「退出」（或按 `⌘Q`）。如果开启了关闭到托盘，关窗口不会退出应用。
3. 打开新版 DMG，把 MathMover 拖到「应用程序」，确认替换旧版。
4. 重新启动 MathMover。系统若再次要求批准打开，请按上面的说明操作。

Mac 版目前提供新版提醒和下载入口，不会在后台自动替换应用。网络不可用时，可以直接从 Releases 下载更新。

## 课件与设置

用户数据默认保存在：

```text
~/Library/Application Support/MathMover
```

替换「应用程序」中的 MathMover 不会删除这里的课件、对话和设置。需要备份时，先退出应用，再备份这个目录。对外分享备份前，请检查是否包含模型密钥或私人题目。
