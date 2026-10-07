# SOP: fixed-point —— 定点建点（坐标 + 三件套 + 设色）

触发：题目给出明确坐标或可推出确定位置的点（顶点、圆心、原点等）。

片段：
```
A = (0, 3)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
SetColor(A, "Blue")
```

变体：
- 坐标含根号/分数时写精确表达式：`A = (sqrt(3), 0)`、`B = (0, -1/2)`，绝不写小数近似。
- 题目没给坐标但给了几何条件（如"BC 的中点"）：用对应构造命令建点（Midpoint 等），
  再加同一套属性行，见 geometric-relations 卡。
- 需要隐藏标签的点（如纯结构点）：只写 `SetFixed(A, true)`，标签三件套省略。

注意：
- 三件套 = SetFixed + ShowLabel + SetLabelMode(1)，顺序固定，紧跟定义行。
- 立体几何定点坐标是三维 `(x, y, z)`，其余相同。
- 颜色规范：定点/核心点 Blue，动点 Red，交点 DarkGreen，辅助对象 Gray——保持全图配色克制。
