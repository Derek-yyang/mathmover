# 首页静态部署（Cloudflare Pages）

此目录是首页的静态构建入口，直接复用 `../app/page.tsx`、`../app/layout.tsx` 和现有组件。以后修改首页仍编辑原文件，无需同步另一份页面。

## 本地构建与预览

在 `math-mover-next` 目录运行：

```sh
npm ci
npm run build:site
```

构建完成后，发布文件位于 `math-mover-next/site/out/`。`build:site` 会自动校验页面资源、下载链接、文件大小，以及是否误包含工作台/API/GeoGebra 运行库。也可以用 `npm run verify:site` 单独复查产物。

预览静态文件：

```sh
npx serve site/out
```

打开该命令显示的本地地址。无需启动 Next.js 服务、daemon 或模型 API，也无需安装 GeoGebra 运行库。示例图形、自动演示、滚动交互、FAQ 和主题切换都在浏览器中运行。下载按钮仍指向 GitHub Releases 的固定安装包地址。

普通工作台/桌面端继续使用原有 `npm run build`，其配置仍是 `output: 'standalone'`。静态入口使用 `output: 'export'`，只注册首页与图标，不复制主工程的 `public/`。

## Cloudflare Pages 配置

先将这些源文件提交并推送到 GitHub，再在 Cloudflare 控制台进入 **Workers & Pages → Create application → Pages → Connect to Git**，连接 `Derek-yyang/mathmover` 仓库。

构建设置填写：

| 配置项 | 值 |
| --- | --- |
| 项目名称 | `mathmover`（如果被占用，可换名称） |
| 生产分支 | `master` |
| 根目录 / Root directory | `math-mover-next` |
| 框架预设 / Framework preset | `None`（使用下面的自定义命令） |
| 构建命令 / Build command | `npm run build:site` |
| 构建输出目录 / Build output directory | `site/out` |
| 环境变量 | `NODE_VERSION` = `22` |

Cloudflare 会在根目录安装 npm 依赖，构建命令不需要再执行一次 `npm ci`。仓库里的 `packages/` 需保持原位置，供前端的本地文件依赖安装使用。

点击 **Save and Deploy**。成功后通过 Cloudflare 分配的 `*.pages.dev` 地址访问。首次上线检查下载链接、桌面/手机布局、主题切换、自动演示、案例切换和 FAQ。

后续向 `master` 推送更新会自动触发生产部署。首页部署与桌面安装包发布相互独立；Windows 和 Mac 安装包分别使用固定的 `releases/latest/download/MathMover-Setup.exe` 与 `releases/latest/download/MathMover-mac-arm64.dmg` 地址，不需要随版本修改首页。Mac 下载仅适用于 Apple 芯片。

如已有自己的域名，在该 Pages 项目的 **Custom domains** 中添加，并按控制台提示设置 DNS。没有域名也可以先使用分配的 `pages.dev` 地址。

## 排查构建问题

- 提示找不到 `build:site`：确认代码已推送，根目录填的是 `math-mover-next`。
- 提示找不到输出目录：填写 `site/out`，不要填 `.next` 或 `out`。
- 构建触发了 `ggb:check`：命令应为 `npm run build:site`，不是 `npm run build`。
- 找不到 `../packages/`：连接完整的 GitHub 仓库，不要只上传前端源文件。
- 页面显示旧内容：检查本次部署对应的提交及生产分支是否正确。

参考：[Cloudflare Pages Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/)、[Next.js 静态导出](https://nextjs.org/docs/app/guides/static-exports)。
