# SOP: moving-point-region — 区域自由点与双参数点

输入：有效有限区域 regionR，或已定义、不共线的三角形顶点 A/B/C。

<!-- example: motion-region-free -->
```ggb
P = PointIn(regionR)
SetColor(P, "Red")
ShowLabel(P, true)
SetLabelMode(P, 1)
```

<!-- example: motion-region-triangle -->
```ggb
u = Slider(0, 1, 0.01)
v = Slider(0, 1, 0.01)
SetValue(u, 0.3)
SetValue(v, 0.4)
P = A + u*(B-A) + (1-u)*v*(C-A)
SetColor(P, "Red")
```

写法注意：PointIn(regionR) 可在区域内拖动，Point(regionR) 只在边界。三角形片段的重心权重为 (1-u)*(1-v)、u、(1-u)*v，非负且和为 1，适用于二维/三维共面三角形。u=1 时 v 不改变顶点位置是正常参数退化。不要用无限平面代替有限面。**三维视图里不要用双参数滑块**：滑块在 3D 同样不可见，改用可直接拖动的点（区域边界上的路径点等），别让用户去拖一个看不见的控件。
