# SOP: circle-tangent — 圆、圆弧、切线与切点

适用：圆心/半径、三点作圆、圆上的切线和圆外点切线。前置：半径>0，三点作圆时不共线。

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

片段：圆外点 P 的两切线与垂足切点。
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

边界：
- P 在圆外有两切线、圆上有一切线、圆内无实切线；单切线分支用 Tangent(P,circleC)，不要取第二元素。
- 指定弧用 Arc(circleC,U,V)，核对逆时针方向和长短；半圆端点应为直径两端。扇形与弧不是同一对象。
- 三维圆需明确平面/轴向，可 Circle(O,r,nAxis)，不依赖二维默认平面。
- 函数切线用 Tangent(横坐标,f) 分支；圆锥曲线切线同样先判断数量和位置。
检查：切点在圆上且半径垂直切线；切线通过 P；具名切点/圆心可见，纯辅助半径直线隐藏。
