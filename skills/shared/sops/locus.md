# SOP: locus — 轨迹与驱动写法

输入：真正依赖驱动的派生点 Q；首例 P 是直接拖动的路径点，第二例 t 是滑块。

<!-- example: locus-driver-point -->
```ggb
Q = Midpoint(A, P)
locQ = Locus(Q, P)
SetColor(locQ, "Red")
```

<!-- example: locus-driver-slider -->
```ggb
t = Slider(-2, 2, 0.05)
Q = (t, t^2)
locQ = Locus(Q, t)
SetColor(locQ, "Red")
```

写法注意：Locus(Q,P) 的 P 是驱动路径点；Locus(Q,t) 的 t 是相关滑块。两参数 Point(path,t) 或 PathParameter 相关构造可能使 Locus 未定义，优先直接拖动点分支或解析坐标滑块分支。三维轨迹不能默认套二维 Locus；可用已验证的 Curve(x(t),y(t),z(t),t,tMin,tMax)。路径和轨迹重合时无需重复对象。
