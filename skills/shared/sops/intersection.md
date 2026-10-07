# SOP: intersection —— 交点（Intersect + 索引消歧 + 隐藏轴线变体）

触发：任何"交于/交点/与 x 轴 y 轴交/两线相交"的场景。交点永远用 Intersect，绝不解方程手算。

片段（两对象直接相交）：
```
C = Intersect(lineMB, yAxis_line)
```

片段（索引消歧，取第 n 个交点）：
```
F = Intersect(l, f, 2)
```

片段（与坐标轴相交：先造隐藏轴线再求交）：
```
xAxis_line = Line((0, 0), (1, 0))
SetVisibleInView(xAxis_line, 1, false)
D = Intersect(lineMA, xAxis_line)
```

变体：
- 单交点（切点）：不写索引。
- 直线与曲线两交点取其一：索引 1 / 2，配合几何位置判断取哪个（联立次数先想清楚）。
- 3D：线面交点 `Intersect(line, plane)`，两平面交线 `Intersect(plane1, plane2)`。

注意：
- Intersect 索引从 1 开始（坑手册 §8）。
- 交点个数没把握时先推理联立次数再写索引；盲写索引 2 会在单交点场景建出未定义对象连坐（坑手册 §2）。
- 交点按 fixed-point 卡加属性行；隐藏轴线必须 SetVisibleInView 隐藏（aux-line 卡）。
