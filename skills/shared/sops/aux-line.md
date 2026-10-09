# SOP: aux-line — 线与辅助线样式

输入：已有点 A、D 或直线 lineAB；主体/辅助样式由构造方案确定。

<!-- example: auxiliary-line -->
```ggb
segAD = Segment(A, D)
SetLineStyle(segAD, 2)
SetColor(segAD, "Gray")
```

<!-- example: auxiliary-perpendicular -->
```ggb
perpD = PerpendicularLine(D, lineAB)
SetLineStyle(perpD, 2)
SetColor(perpD, "Gray")
```

写法注意：有限、无限、单向对象分别写 Segment(A,B)、Line(A,B)、Ray(A,B)。PerpendicularLine 首参是点，第二参是目标对象；片段的点线写法用于二维。SetLineStyle(...,2) 为虚线，0 为实线；主线可 Black/Blue，辅助可 Gray。线宽用输入栏命令 SetLineThickness，不混用 JavaScript API。纯计算对象按目标视图隐藏。
