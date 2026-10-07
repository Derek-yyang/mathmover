# SOP: aux-line —— 辅助线样式规范（虚线 + 弱色 + 先定义后属性）

触发：中位线、高线、角平分线、对称轴、路径线、任何非题目主角的线。

片段：
```
segAD = Segment(A, D)
SetLineStyle(segAD, 2)
SetColor(segAD, "Gray")
```

片段（角平分线 / 垂线 / 中垂线）：
```
bis = AngleBisector(B, A, C)
SetLineStyle(bis, 2)
SetColor(bis, "Gray")
perp = PerpendicularLine(D, lineBC)
SetLineStyle(perp, 2)
SetColor(perp, "Gray")
```

片段（构造性辅助直线，纯计算用）：
```
xAxis_line = Line((0, 0), (1, 0))
```

变体：
- 主角线（题目明确研究的直线 l、线段 AB）：实线 + 显著色（Black/Blue），不虚化。
- 动点连线（如 A1F）：红虚线。
- 坐标轴的替身线：建出后立刻隐藏（hidden-helper 卡），不设样式。

注意：
- 辅助线一律虚线（SetLineStyle 2）+ 弱色（Gray），与主角区分——判分里"辅助线/标注缺口"
  是 partial 的主因，画出来比画漂亮重要。
- 属性行紧跟定义行（坑手册 §7）。
- PerpendicularLine 参数顺序：点在前、直线在后（坑手册 §6）。
