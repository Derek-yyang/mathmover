# SOP: conic-features —— 圆锥曲线特征件（Focus/Directrix/准线/焦半径）

触发：题目涉及焦点、准线、离心率位置、焦半径/焦距。

片段（焦点，引擎给）：
```
F1 = Focus(C_curve)
SetPointSize(F1, 4)
SetColor(F1, "DarkGreen")
SetLabelMode(F1, 1)
ShowLabel(F1, true)
```

片段（准线）：
```
d_line = Directrix(C_curve)
SetLineStyle(d_line, 2)
SetColor(d_line, "Gray")
```

片段（焦半径连线，动点 M 到焦点）：
```
segMF1 = Segment(M, F1)
SetLineStyle(segMF1, 2)
SetColor(segMF1, "Gray")
```

变体：
- 双曲线两焦点：`Focus(C_curve)` 返回列表时取 `F1 = Focus(C_curve, 1)`、`F2 = Focus(C_curve, 2)`；
  或按精确坐标直接建点（curve-definition 卡的 sqrt 表达式）。
- 第二准线同理 Directrix(C_curve, 1/2)。

注意：
- 焦点坐标永远由引擎给（Focus 命令或 sqrt 精确表达式），绝不手算小数（curve-definition 卡同源纪律）。
- 题目提到焦点/准线就画出来——这是圆锥曲线题的"地标"，漏画即视觉完整度缺口。
- 焦点用小点 + 显著色（DarkGreen/Blue），不要与动点红色混淆。
