# SOP: projection-foot — 垂足、投影与距离线段

适用：点到直线/平面的垂足、最短距离。前置：目标对象非退化；最短距离到无限直线与有限线段不同。

片段：二维直线垂足，P 不在 lineAB 上。
<!-- example: projection-line-2d -->
```ggb
footLine = PerpendicularLine(P, lineAB)
H = Intersect(footLine, lineAB)
segPH = Segment(P, H)
```

片段：三维平面垂足。
<!-- example: projection-plane-3d -->
```ggb
footLine = PerpendicularLine(P, planeABC)
H = Intersect(footLine, planeABC)
segPH = Segment(P, H)
```

边界：
- 三维点到直线可 PerpendicularLine(P,lineAB,space) 后求交；若 P 已在线上直接 H=P，不造未定义垂线。
- P 已在目标平面时垂足就是 P；零距离允许，Segment(P,P) 不作为必需对象。
- 有限线段最短点：先求所在直线垂足，判断是否在线段内；否则比较端点。到有限面也须检查投影是否在面内。
- 距离可 Distance(P,lineAB)/Distance(P,planeABC)；题目需要图示时保留垂足和连接段，不用数字替代图形。
检查：H 在目标对象上，PH 与目标垂直；最近点范围符合题意，具名垂足保留标签。
