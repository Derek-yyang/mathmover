This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### 官网首页部署

首页可以单独构建为静态网站：`npm run build:site`，产物位于 `site/out/`，无需 GeoGebra 运行库或后端服务。Cloudflare Pages 的完整构建设置与操作步骤见 [首页部署说明](site/README.md)。

### 本地 GeoGebra 画板（无需外网）

首次配置需要联网，先在本目录运行：

```bash
npm run ggb:install
npm run dev
```

当前设备已安装官方运行库 5.4.931.2。之后启动、刷新画板不访问 GeoGebra CDN，也不依赖浏览器缓存；只需本机 Next.js 服务正常运行。`ggb:check` 会校验所有资源，不会联网。开发、构建和启动前会自动检查，资源缺失时明确报错而不回退到 CDN。

运行库放在 `public/vendor/geogebra/`，未纳入 Git。换电脑或重新克隆后需安装一次，也可以使用已下载的 ZIP：`npm run ggb:install -- <ZIP路径>`。安装脚本固定官方版本并验证 SHA-256，保留原始文件与字体许可；Windows 使用自带 PowerShell，Linux/macOS 需要 `unzip`。升级时需同步更新 `geogebra-runtime.json` 中的版本、地址和校验值。

这只保证项目内画板本地加载与已有课件交互。AI 生成功能仍需联网；导出的 HTML 仍使用在线运行库；引用网络图片或在线素材的课件仍需要其对应资源。

运行库使用 [GeoGebra 许可](https://www.geogebra.org/license)，不等同于无条件可商用；商业分发前应核实授权。加载方式遵循 [官方离线部署文档](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_Embedding/)。

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
