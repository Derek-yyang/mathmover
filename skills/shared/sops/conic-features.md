# SOP: conic-features — 焦点、准线与焦半径

适用：题目涉及圆锥曲线的焦点、准线、焦半径。前置：conicC 是圆锥曲线对象而不是函数 f(x)。

片段：抛物线单焦点/单准线。
<!-- example: conic-single-features -->
```ggb
F = Focus(conicC)
directrixD = Directrix(conicC)
ShowLabel(F, true)
SetLabelMode(F, 1)
SetColor(F, "Blue")
```

片段：椭圆/双曲线两焦点，用列表显式承接多结果。
<!-- example: conic-double-features -->
```ggb
focusPts = {Focus(conicC)}
F1 = Element(focusPts, 1)
F2 = Element(focusPts, 2)
segMF1 = Segment(M, F1)
segMF2 = Segment(M, F2)
```

边界：
- Focus(conic,索引)、Directrix(conic,索引) 不是本库采用的写法；多结果以 {命令(...)} 收集，再 Element。
- F1/F2 的索引与题意的左/右焦点未必一致，核对位置后命名；若曲线由题给焦点定义，优先复用这些点，不另造重叠点。
- 椭圆/双曲线多准线按同样收集原则，仅展示题意相关对象；圆无有限焦点对/准线，不套此卡。
- 派生焦点随曲线参数更新，不写死当前坐标；收集列表和冗余点按 hidden-helper 处理。
检查：焦点/准线数量和类型正确，命名与题意对应；焦半径端点引用实际具名焦点。
