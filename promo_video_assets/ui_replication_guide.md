# UI 还原参考指南

为了在 Remotion 中 1:1 高仿 MathMover 的 UI，我们选择了**方式三（提供前端代码片段）**，因为我们的项目正是使用 React + Tailwind CSS 开发的。

## 1. 核心页面代码

我们已经将核心的页面代码提取到了 `promo_video_assets/source_code` 目录下。你可以直接参考这些代码中的 Tailwind CSS 类名来复刻 UI：

- **`dashboard/page.tsx`**: 
  - 这是最核心的工作台页面。
  - 包含了：顶部的项目切换栏、中间的上传区域（支持拖拽）、底部的 GeoGebra 画板展示区，以及右侧的属性面板（参数控制滑块、GGB 指令展示）。
  - **核心组件参考**: 
    - 上传区域卡片: `className="relative z-10 w-full max-w-4xl bg-white rounded-2xl shadow-sm border border-stone-100 p-6..."`
    - 生成按钮: `className="w-full h-[42px] bg-emerald-500 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-600..."`
    - 右侧属性面板: `className="w-80 bg-[#FDFCF8] border-l border-stone-200 flex flex-col z-30..."`

- **`page.tsx`**:
  - 这是落地页（Landing Page）。
  - 包含了我们漂亮的导航栏（带 Logo）、Hero 区域的标题和渐变按钮，以及特性展示卡片。
  - **核心组件参考**:
    - Logo 样式: `w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-[4px_4px_0px_0px_rgba(16,185,129,0.2)] transform -rotate-2`
    - 主 CTA 按钮: `bg-gradient-to-r from-emerald-500 to-green-600 shadow-[6px_6px_0px_0px_rgba(16,185,129,0.25)] rounded-2xl`

- **`GeoGebraBoard.tsx`**:
  - 封装的 GeoGebra 画板组件，你可以了解我们在真实项目中是如何嵌入画板的（视频中可以用一个带圆角的 div 或直接使用案例截图来模拟）。

## 2. 核心动画与交互流（建议的 Remotion 场景时间轴）

基于我们的实际代码逻辑，建议你的 Remotion 视频包含以下几个核心镜头（Scene）：

1. **镜头一：拖拽上传 (Upload Scene)**
   - 画面：展示工作台的上传卡片。
   - 动画：鼠标指针拖拽一张数学题目的图片（例如 `case1.png` 或 `case3.png`）到虚线框内。
   - 细节：拖拽进入时，边框变成 `border-emerald-400 bg-emerald-50/30`。

2. **镜头二：AI 解析与进度条 (Loading & Parsing Scene)**
   - 画面：点击“生成演示”按钮。
   - 动画：按钮变成 Loading 状态，上方出现进度条和动态文本。
   - 细节：文本依次闪烁显示：“正在识别题目图像信息...” -> “正在推导几何约束关系...” -> “正在生成 GeoGebra 绘图指令...”。

3. **镜头三：结果渲染与交互 (Result & Interaction Scene)**
   - 画面：下方的画板区域亮起，瞬间渲染出动态几何图形。同时右侧面板弹出参数滑块和 GGB 指令代码。
   - 动画：鼠标去拖动右侧的参数滑块（例如 `t` 的值改变），左侧画板中的动点轨迹随之丝滑变化。

## 3. 设计规范 (Design Tokens)

为了让你不需要逐行翻代码，这里总结了我们在 Tailwind 中常用的设计规范：

- **背景色**: 整个工作台底色是暖白色 `bg-[#FDFCF8]`，中间画布区是 `bg-[#F5F5F0]/50`。
- **卡片样式**: 多数卡片使用 `bg-white rounded-2xl border border-stone-100 shadow-sm`。
- **主色调 (Primary)**: `emerald-500` (#10b981) 到 `green-600` (#16a34a) 的渐变。
- **文字颜色**: 主标题 `text-stone-800`，副文本 `text-stone-500`，代码/小标签 `text-stone-400`。
- **字体**: 使用了 Tailwind 默认的 `font-sans`，数字和指令区使用了 `font-mono`。

你可以直接把这个 `source_code` 文件夹和这份指南发给 Remotion 项目的 AI，它有了真实的 React/Tailwind 代码，就能做到 99% 的完美复刻！