# 上游来源

本包 fork 自 **[nexu-io/open-design](https://github.com/nexu-io/open-design)** 的
`packages/dsh-runtime`（Apache-2.0，见 `LICENSE.upstream`）。

原始包名 `@open-design/dsh-runtime`，我们改名为 `@mathmover/dsh-runtime`。

## 改了什么

| | 原 | 现 |
|---|---|---|
| 包名 | `@open-design/dsh-runtime` | `@mathmover/dsh-runtime` |
| 协议 `runtime` 标识 | `open-design` | `mathmover` |
| 插件 id | `open-design-runtime` / `-startup` | `mathmover-runtime` / `-startup` |
| 会话 id 前缀 | `od-` | 随 `runtime` 标识 |
| persona（cordis.patch.yml） | running for OpenDesign | MathMover 画图工作台 |
| `execute` 帧 | 只收单个文本块 | 收内容块数组（文本 + 图片） |

## 为什么 fork 而不是直接依赖

1. 那个包**没发到 npm**（2026-10-12 实测 404），他们随自己的 release 发 tarball；
2. persona 与 `runtime` 标识写死成他们的产品名；
3. 我们要给 `execute` 帧加图片内容块。

## 协议归属

wire 契约（`protocol.ts` 的帧形状）与上游一致，保持兼容是有意的：
宿主侧解析器可与上游实现互换。改帧形状前请先看上游
`apps/daemon/src/agent-protocol/dsh-profile/` 的定义。

## 上游同步

上游有 `dsh-upstream-drift` 检测（`.github/workflows/`）。我们没有自动同步——
若上游修了 bug 或加了帧类型，需人工比对 `src/` 后合入。
