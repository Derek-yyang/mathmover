---
name: MathMover
description: AI-powered dynamic mathematics courseware generator
colors:
  primary: "#10b981"
  primary-dark: "#059669"
  neutral-bg: "#FDFCF8"
  neutral-bg-container: "#F5F5F0"
  neutral-text: "#1c1917"
  neutral-muted: "#78716c"
  border-color: "#e7e5e4"
typography:
  display:
    fontFamily: "Inter, Noto Sans SC, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 800
    lineHeight: 1.2
  body:
    fontFamily: "Inter, Noto Sans SC, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "9999px"
    padding: "10px 24px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  card:
    backgroundColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "24px"
---

# Design System: MathMover

## 1. Overview

**Creative North Star: "The Scholar's Workbench" (学术工作台)**

这套设计系统旨在营造一种融合了传统学术纸张质感与现代数字工具精细感的“学者案头”氛围。整体界面拒绝冰冷、刺眼的纯黑色或纯白色，而是以温暖的纸张本色（Warm Paper）作为主基调，通过精致的网格对齐、充裕的留白以及清爽的翡翠绿（Emerald）作为核心强调色，构建出一个安静、专注的数学探索与课件制作空间。

**Key Characteristics:**
- **纸张质感 (Paper texture)**：使用温暖舒适的乳白/米黄色调，减少长时间备课和学习带来的视觉疲劳。
- **极简边框 (Restrained lines)**：通过柔和的背景色块（Tonal Block）来划分区域，避免生硬突兀的分割线。
- **高对比排版 (Typographic Clarity)**：数学符号与正文具有极高对比度，排版讲究几何平衡与比例。

## 2. Colors

整体色彩策略属于 **Restrained（克制型）**，即使用米白与暖灰作为环境主色，翠绿（Emerald）作为全局唯一的动作反馈与核心状态色（使用占比 ≤ 10%），从而突出数学内容的主体地位。

### Primary
- **Emerald Green (翡翠绿)** (#10b981 / oklch(70% 0.17 150)): 用于主按钮、激活状态、成功提示及关键操作节点。
- **Deep Emerald (深翠绿)** (#059669 / oklch(60% 0.16 150)): 用于悬停（Hover）及激活的文字状态。

### Neutral
- **Warm Paper (暖纸白)** (#FDFCF8 / oklch(98% 0.005 85)): 应用程序和主界面的全局底色。
- **Canvas Gray (温润灰)** (#F5F5F0 / oklch(96% 0.005 85)): 工作台背景及侧边栏阴影区域。
- **Stone Black (石板黑)** (#1c1917 / oklch(15% 0.01 70)): 核心文字及粗体标题。
- **Stone Muted (浅石灰)** (#78716c / oklch(55% 0.01 70)): 次要文字说明、输入框提示语。
- **Alabaster Border (骨色边框)** (#e7e5e4 / oklch(90% 0.005 70)): 柔和的卡片边框与细分割线。

**The Rare Accent Rule.** 翠绿色仅能在用户需要采取关键行动（如“开始生成”、“导出课件”、“确认兑换”）或表示当前极关键状态时使用，其余辅助信息、进度指示均采用暖灰色系。

## 3. Typography

**Display Font:** Inter 与 Noto Sans SC（无衬线中英文字体）
**Body Font:** Inter, Noto Sans SC 

### Hierarchy
- **Display** (800, 30px / 1.875rem, 1.2): 用于工作台主标题及首页大版头。
- **Headline** (700, 20px / 1.25rem, 1.3): 用于各功能区块、卡片标题。
- **Title** (600, 16px / 1rem, 1.4): 用于表单标签、弹窗标题、列表项。
- **Body** (400, 14px / 0.875rem, 1.5): 用于描述性正文、输入提示及数学指令的详细解释。
- **Label** (500, 12px / 0.75rem, 1.2): 用于副标题、积分额度数字、时间戳等微型元数据。

**The Readability Rule.** 鉴于涉及大量数学公式（LaTeX）和 GeoGebra 命令代码，英文字体严格遵循等宽/清晰无衬线字体，字距与行高在移动端和电脑端保持一致，不可随意压紧。

## 4. Elevation

系统采用扁平化与色块层级划分（Tonal Layering）为主，物理阴影为辅的设计。

- **工作台底座 (At Rest)**: 采用纯色或 Canvas Gray 色块平铺，完全不使用阴影。
- **浮动卡片与面板 (Elevated Card)**: 悬浮的对话框、右侧操作面板使用极淡、范围极广的软阴影，营造“纸张层叠”的轻盈悬浮感。
  `box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.03), 0 8px 10px -6px rgba(0, 0, 0, 0.01), 0 0 0 1px rgba(0,0,0,0.02)`

**The Layer-By-Color Rule.** 尽量使用背景色对比（例如 `#FFFFFF` 卡片放置在 `#F5F5F0` 的背景上）来表达层级，而不是给所有卡片都加上阴影。

## 5. Components

### Buttons
- **Shape:** 胶囊形全圆角 (pill-shaped, rounded-full)
- **Primary:** 背景为翡翠绿 (#10b981)，文字为纯白，字重 600。
- **Hover:** 变为深翠绿 (#059669)，伴随轻微的缩放反馈 (scale-98)。
- **Ghost:** 无边框，文字为石板黑 (#1c1917)，悬停时使用浅灰色块 (#F5F5F0) 填充。

### Cards
- **Shape:** 大圆角 (24px radius, rounded-3xl) 
- **Style:** 纯白背景 (#FFFFFF)，极细的骨色边框 (1px #e7e5e4)，并在悬停时展示上述的软阴影。

### Inputs / Textareas
- **Style:** 背景色为纯白，圆角 12px，骨色边框。
- **Focus:** 获得焦点时，边框颜色变为翡翠绿 (#10b981)，并带有一层淡绿色的晕染投影，以增强聚焦感。

### Navigation Sidebar
- **Style:** 常规宽度下不加显式边框，使用与背景相近的温润灰 (#F5F5F0/50)。项激活时文字设为翠绿且带有一条精致的小滑块；未激活时文字为次要浅灰色，悬停高亮。

## 6. Do's and Don'ts

### Do:
- **Do** 使用 OKLCH 调整色彩，让暗色模式和亮色模式下的色彩饱和度均符合人眼最佳感受，减少亮色刺眼感。
- **Do** 突出 GeoGebra 画布的中心位置，非必要不打断用户在画布上的交互体验。
- **Do** 为耗时生成过程设计流畅、有反馈的骨架屏（Skeleton）或进度动画。

### Don't:
- **Don't** 在卡片、警告或弹窗的左侧/右侧使用粗线条彩色边框（Side-stripe borders）。
- **Don't** 对非核心的展示文本使用炫目的文本渐变色（Gradient text）。
- **Don't** 在非卡片或非独立弹出层上堆叠玻璃拟态（Glassmorphism）效果。
- **Don't** 使用未经处理的传统深海蓝或刺眼亮黄来代表数学或科技元素。
