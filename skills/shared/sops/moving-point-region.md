# SOP: moving-point-region — 区域内与面内动点

适用：点可在多边形内部/整个面内运动，而非仅沿边界。前置：regionR 是有效有限区域。

<!-- example: motion-region-free -->
```ggb
P = PointIn(regionR)
SetColor(P, "Red")
ShowLabel(P, true)
SetLabelMode(P, 1)
```

片段：三角形面内用两个自由参数演示，A/B/C 已定义且不共线。
<!-- example: motion-region-triangle -->
```ggb
u = Slider(0, 1, 0.01)
v = Slider(0, 1, 0.01)
SetValue(u, 0.3)
SetValue(v, 0.4)
P = A + u*(B-A) + (1-u)*v*(C-A)
SetColor(P, "Red")
```

边界：
- Point(poly) 在边界，PointIn(poly) 在区域；不能以一条线段代替整个二维自由度。
- 三角形参数权重为 (1-u)*(1-v)、u、(1-u)*v，非负且和为 1；适用于共面的二维/三维三角形。
- 区域包含边界与否按题意确定；不要为规避退化自动改成开区间。
- 无限平面不能代替有限面，整个球面/立体内部运动也不能降成三角形区域；这些情况需独立推导约束，不假装已覆盖。
检查：直接拖动或参数低/中/高组合始终在允许区域；能覆盖二维自由度，不锁定 P。
