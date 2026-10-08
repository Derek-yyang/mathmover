# SOP: geometric-relations — 中点、定比、平行、垂直与变换

适用：题目通过关系而非独立坐标定义对象。前置：输入点/线已定义且满足非退化条件。

片段：已有互异点 A、B 和直线 lineAB。
<!-- example: relations-basic -->
```ggb
M = Midpoint(A, B)
Q = A + (2/5) * (B - A)
parallelP = Line(P, lineAB)
perpP = PerpendicularLine(P, lineAB)
```
这里 2/5 仅演示 AP:PB=2:3 的内分，不能照搬。

片段：A、B、D 是平行四边形相邻顶点，C 为对角顶点；关于点/直线对称。
<!-- example: relations-transform -->
```ggb
C = B + D - A
R = Reflect(P, lineAB)
S = Reflect(P, M)
```

边界：
- AQ:QB=m:n 的内分点为 A+m/(m+n)*(B-A)。AQ/AB=k 才用 A+k*(B-A)；外分须按有向比例另推，分母不能为零。
- 平行用 Line(P,l)，垂直用 PerpendicularLine(P,l)，不能混写。向量方向线用 Line(P,Vector(A,B))。
- 中点、比例和向量关系适用于三维；三维垂直必须说明上下文。空间垂足见 projection-foot，不套二维旋转向量。
- 角平分线用 AngleBisector(B,A,C)，角顶点为 A；中心/轴反射、平移、旋转分别用 Reflect/Translate/Rotate，按题意给中心与角度。
- 派生点保留表达式，属性参考 fixed-point 的派生分支。
检查：比例方向、平行/垂直、顶点对应均成立；驱动变化后关系仍成立。
