# SOP: closed-region — Polygon 与有限面填充

输入：已定义、按边界顺序排列的顶点；三维顶点必须共面。

<!-- example: polygon-region -->
```ggb
polyABCD = Polygon(A, B, C, D)
SetFilling(polyABCD, 0.15)
SetColor(polyABCD, "Blue")
ShowLabel(polyABCD, false)
```

写法注意：Polygon 会生成额外边对象和标签，避开自动小写边名。动态点直接引用，不替换为当前坐标。仅绘边界可逐条 Segment；Polyline 闭合需重复首点。SetFilling 取 0..1。Polygon 只表示直边多边形；圆盘/扇形使用圆/扇形对象，不能套此片段。
