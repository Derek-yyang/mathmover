# SOP: geometric-relations — 关系点、平行垂直与变换写法

输入：已定义点及目标直线；关系分支所需参数非退化。

<!-- example: relations-basic -->
```ggb
M = Midpoint(A, B)
Q = A + (2/5) * (B - A)
parallelP = Line(P, lineAB)
perpP = PerpendicularLine(P, lineAB)
```

<!-- example: relations-transform -->
```ggb
C = B + D - A
R = Reflect(P, lineAB)
S = Reflect(P, M)
```

写法注意：内分 AQ:QB=m:n 写 A+m/(m+n)*(B-A)；AQ/AB=k 才写 A+k*(B-A)。外分按有向比例代入且分母非零。平行 Line(P,l)，二维垂直 PerpendicularLine(P,l)，方向线 Line(P,Vector(A,B))。AngleBisector(B,A,C) 的角顶点是 A。Reflect/Translate/Rotate 分别引用对称对象、向量或中心角度；三维垂线须明确空间/平面。
