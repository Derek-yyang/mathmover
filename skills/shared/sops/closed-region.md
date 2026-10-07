# SOP: closed-region —— 封闭区域（Polygon + 轻填充 + 标签可见性）

触发：题目涉及三角形/四边形/多边形（含动态三角形）。

片段（静态多边形）：
```
polyABCD = Polygon(A, B, C, D)
SetFilling(polyABCD, 0.2)
SetColor(polyABCD, "Blue")
```

片段（动态三角形，淡填充不抢戏）：
```
polyPFE = Polygon(P, F, E)
SetFilling(polyPFE, 0.3)
SetColor(polyPFE, "Red")
ShowLabel(polyPFE, false)
```

变体：
- 只要边不要面（3D 或轻量场景）：用 Polyline 或逐条 Segment（见 3d-edges 卡）。
- 中线/角平分线分割出的子三角形：也用 Polygon 建出并淡填充，突出面积关系。

注意：
- Polygon 会自动占用小写字母名 a、b、c… 作边名（坑手册 §5），不要拿这些名当别的对象名。
- 动态多边形顶点含动点时，填充透明度 0.05-0.3 之间取轻值，避免大面积色块压住图形。
- 面积类题目三角形标签默认关（ShowLabel false），点标签已经足够传达。
