# SOP: circle-tangent — 圆、圆弧与切线写法

输入：圆心 O、正半径 radiusR 或三个不共线点；外点切线示例需要已有 O、circleC 和圆外点 P。

<!-- example: circle-center-radius -->
```ggb
circleC = Circle(O, radiusR)
SetColor(circleC, "Black")
```

<!-- example: circle-three-points -->
```ggb
circleC = Circle(A, B, C)
O = Center(circleC)
```

<!-- example: circle-external-tangents -->
```ggb
tangentLines = {Tangent(P, circleC)}
tangent1 = Element(tangentLines, 1)
tangent2 = Element(tangentLines, 2)
radiusLine1 = PerpendicularLine(O, tangent1)
radiusLine2 = PerpendicularLine(O, tangent2)
T1 = Intersect(tangent1, radiusLine1)
T2 = Intersect(tangent2, radiusLine2)
```

写法注意：Tangent(P,circleC) 在圆外产生两线，用 {Tangent(...)} 和 Element 承接；P 在圆上只用单线分支，圆内无实切线。切点可由圆心垂线与切线求交。Arc(circleC,U,V) 按逆时针弧，需要 U/V 在圆上。三维圆用 Circle(O,r,nAxis) 明确法向。函数切线用 Tangent(横坐标,f)，圆锥曲线切线按结果数量承接。
