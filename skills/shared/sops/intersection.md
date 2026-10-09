# SOP: intersection — 求交与多结果承接

输入：已定义、确有目标交集的线/曲线/平面；多点分支需两个不同交点。

<!-- example: intersect-single -->
```ggb
X = Intersect(lineAB, lineCD)
ShowLabel(X, true)
SetLabelMode(X, 1)
```

<!-- example: intersect-multiple -->
```ggb
crossPts = {Intersect(lineAB, circleC)}
X1 = Element(crossPts, 1)
X2 = Element(crossPts, 2)
```

写法注意：多结果写 {Intersect(...)} 后 Element，或支持索引的重载 Intersect(l,c,1/2)，索引从 1 开始，不承诺题意位置。一般函数数值求交可 Intersect(f,g,xMin,xMax)。坐轴可引用 xAxis/yAxis。平行/重合无唯一有限点，相切不取第二点；无效交点不用于下游。三维线面返回点、面面返回线、面与球返回曲线；不要把所有结果当坐标点。
