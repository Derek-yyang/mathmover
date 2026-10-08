# SOP: moving-point-path — 路径点与弧段写法

输入：已定义的一维路径 pathObj；弧段分支输入圆/椭圆 conicC 上的合法端点 U、V。

<!-- example: motion-path-free -->
```ggb
P = Point(pathObj)
SetColor(P, "Red")
ShowLabel(P, true)
SetLabelMode(P, 1)
```

<!-- example: motion-path-slider -->
```ggb
t = Slider(0, 1, 0.01)
SetValue(t, 0.5)
P = Point(pathObj, t)
SetColor(P, "Red")
ShowLabel(P, true)
SetLabelMode(P, 1)
```

<!-- example: motion-arc -->
```ggb
arcUV = Arc(conicC, U, V)
SetLineStyle(arcUV, 2)
SetColor(arcUV, "Gray")
P = Point(arcUV)
SetColor(P, "Red")
```

写法注意：Point(pathObj) 可直接拖动；Point(pathObj,t) 由 t 驱动，两种写法择需使用。0..1 是路径参数，不是角度/横坐标/匀速时间，无界路径需核对实际覆盖。Arc(conicC,U,V) 按逆时针取弧。Point(region) 只在边界；区域内点用 PointIn。与 Locus 组合时避免无条件使用双参数 Point。
