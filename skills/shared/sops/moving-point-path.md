# SOP: moving-point-path — 路径约束与两种驱动

适用：点在线段、圆、椭圆弧等一维路径上运动。前置：pathObj 已构造；范围必须与题意一致。

片段：用户直接拖动路径上的点，不必另加滑块。
<!-- example: motion-path-free -->
```ggb
P = Point(pathObj)
SetColor(P, "Red")
ShowLabel(P, true)
SetLabelMode(P, 1)
```

片段：需要滑块演示的有限路径。
<!-- example: motion-path-slider -->
```ggb
t = Slider(0, 1, 0.01)
SetValue(t, 0.5)
P = Point(pathObj, t)
SetColor(P, "Red")
ShowLabel(P, true)
SetLabelMode(P, 1)
```

片段：圆/椭圆上题给合法端点 U、V 的逆时针弧。
<!-- example: motion-arc -->
```ggb
arcUV = Arc(conicC, U, V)
SetLineStyle(arcUV, 2)
SetColor(arcUV, "Gray")
P = Point(arcUV)
SetColor(P, "Red")
```

边界：
- U、V 必须由题给条件或引擎构造，并在该曲线上；不照搬某椭圆的 (2,0)/(0,1)。核对弧方向、长短与经过区域。
- 0..1 是路径参数，不是角度、横坐标或匀速时间。用于无界路径时要确认实际覆盖，不能承诺有限参数覆盖全曲线。
- 路径可跨二维/三维；曲面或区域内运动用 moving-point-region，不降成一条线。
- 只为导航的路径灰虚线；题目主体曲线保留主图样式，不因被用作路径而弱化。
- 直接拖动点与滑块驱动点是两种合法机制。Point(path,t) 的点由 t 驱动；若要直接拖点，选无第二参数分支。
- 若要构造该点/派生点的 Locus，另看 locus 的兼容限制。
检查：点在目标路径与允许部分上；通过对应驱动方式可动；端点包含性符合题意。
