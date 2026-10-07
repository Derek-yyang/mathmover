# SOP: moving-point-path —— 路径动点（路径对象 + 滑块 + Point(路径, t)）

触发：动点在已知轨迹上运动（圆/弧/线段/多边形边上/椭圆弧）。

片段（圆上动点）：
```
pathC = Circle(A, 2)
SetLineStyle(pathC, 2)
SetColor(pathC, "Gray")
t = Slider(0, 1, 0.01)
C = Point(pathC, t)
SetColor(C, "Red")
ShowLabel(C, true)
SetLabelMode(C, 1)
```

片段（椭圆弧上动点：先取弧端点再构 Arc）：
```
V_right = (2, 0)
V_top = (0, 1)
SetVisibleInView(V_right, 1, false)
SetVisibleInView(V_top, 1, false)
arcM = Arc(C_curve, V_right, V_top)
t_m = Slider(0.01, 0.99, 0.01)
M = Point(arcM, t_m)
SetColor(M, "Red")
```

片段（线段轨迹，端点已推导）：
```
pathF = Segment(M, N)
SetLineStyle(pathF, 2)
SetColor(pathF, "Red")
F = Point(pathF)
```

变体：
- 多边形边上动点：`Point(poly1, t)` 或 `Point(Segment(A, B), t)`。
- 轨迹本身是题目要观察的答案时，另加 locus 卡画轨迹对象。
- 端点/中间推导点若只是结构性的：建出来后 SetVisibleInView 隐藏（hidden-helper 卡）。

注意：
- 动点必须由滑块驱动（判官校准铁律：动点必须真实可拖才可 pass）。
- 路径对象一律灰色或红色虚线（SetLineStyle 2）——它是舞台不是主角。
- 滑块范围 0..1 步长 0.01 是通用默认；弧上取 0.01..0.99 避免端点退化。
