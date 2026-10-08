# SOP: projection-foot — 垂足与连接段写法

输入：点 P 与非退化目标直线/平面。

<!-- example: projection-line-2d -->
```ggb
footLine = PerpendicularLine(P, lineAB)
H = Intersect(footLine, lineAB)
segPH = Segment(P, H)
```

<!-- example: projection-plane-3d -->
```ggb
footLine = PerpendicularLine(P, planeABC)
H = Intersect(footLine, planeABC)
segPH = Segment(P, H)
```

写法注意：二维直线写 PerpendicularLine(P,lineAB)；三维直线可 PerpendicularLine(P,lineAB,space)，三维平面写 PerpendicularLine(P,planeABC)，再求交。P 已在目标上时 H=P，不必造零长连接段。Distance(P,lineAB/planeABC) 返回距离；有限段/面需另核对投影位置。
