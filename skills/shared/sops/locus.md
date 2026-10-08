# SOP: locus — 派生点轨迹与驱动类型

适用：题目要求观察或构造点 Q 随驱动变化的轨迹。前置：Q 与驱动之间存在真实依赖。

片段：P 是 Point(pathObj) 直接拖动的路径点，A 为已有定点。
<!-- example: locus-driver-point -->
```ggb
Q = Midpoint(A, P)
locQ = Locus(Q, P)
SetColor(locQ, "Red")
```

片段：坐标由滑块 t 驱动；示例对应抛物线弧。
<!-- example: locus-driver-slider -->
```ggb
t = Slider(-2, 2, 0.05)
Q = (t, t^2)
locQ = Locus(Q, t)
SetColor(locQ, "Red")
```

边界：
- 第二参可以是驱动路径点 P，也可以是滑块 t；不能写一个与 Q 无关的点或参数。
- 官方手册警告两参数 Point 或 PathParameter 相关构造可能导致轨迹未定义；不能把 Point(path,t)+Locus 无条件组合。优先用直接拖动路径点分支，或可解析的坐标参数分支，并实测。
- 已证明轨迹是线段/圆/弧时可用该对象表示，端点/分支必须与允许范围一致；未经推导不能猜轨迹形状。
- Locus 表示点轨迹；直线族包络不是同一任务。三维轨迹不要假设二维 Locus 可直接推广，可用已验证的 Curve 参数表达式。
- 路径与轨迹重合时避免重复画；辅助路径灰虚线、题目所求轨迹红色。
检查：轨迹有定义，样本点落在轨迹上；范围/分支正确，驱动变化确实改变 Q。
