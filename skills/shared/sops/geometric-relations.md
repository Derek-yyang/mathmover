# SOP: geometric-relations — 关系点、平行垂直、变换与样式写法

输入：已定义点及目标直线；关系分支所需参数非退化。样式分支需要已构造的主体或辅助对象。

<!-- example: fixed-independent -->
```ggb
A = (sqrt(3), -1/2)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
SetColor(A, "Blue")
```

<!-- example: fixed-derived -->
```ggb
M = Midpoint(B, C)
ShowLabel(M, true)
SetLabelMode(M, 1)
SetColor(M, "Blue")
```

<!-- example: relations-basic -->
```ggb
M = Midpoint(A, B)
Q = A + (2/5) * (B - A)
parallelP = Line(P, lineAB)
perpP = PerpendicularLine(P, lineAB)
```

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

<!-- example: relations-transform -->
```ggb
C = B + D - A
R = Reflect(P, lineAB)
S = Reflect(P, M)
```

写法注意：内分 AQ:QB=m:n 写 A+m/(m+n)*(B-A)；AQ/AB=k 才写 A+k*(B-A)。外分按有向比例代入且分母非零。平行 Line(P,l)。二维垂直 **PerpendicularLine(点, 目标对象)**——首参是点、第二参是目标对象，写反会连锁失败；方向线 Line(P,Vector(A,B))。AngleBisector(B,A,C) 的角顶点是 A。Reflect/Translate/Rotate 分别引用对称对象、向量或中心角度；三维垂线须明确空间/平面。辅助对象画虚线 SetLineStyle(...,2)、着灰 SetColor(...,"Gray")，主体 Black/Blue、实线 0；线宽只用输入栏命令 SetLineThickness，不混用 JavaScript API。定点与派生点的坐标、锁定规矩见通用 GGB 写法。
