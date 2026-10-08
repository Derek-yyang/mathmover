# SOP: conic-features — 焦点、准线与焦半径写法

输入：圆锥曲线对象 conicC；双焦点片段另需已定义点 M。

<!-- example: conic-single-features -->
```ggb
F = Focus(conicC)
directrixD = Directrix(conicC)
ShowLabel(F, true)
SetLabelMode(F, 1)
SetColor(F, "Blue")
```

<!-- example: conic-double-features -->
```ggb
focusPts = {Focus(conicC)}
F1 = Element(focusPts, 1)
F2 = Element(focusPts, 2)
segMF1 = Segment(M, F1)
segMF2 = Segment(M, F2)
```

写法注意：Focus/Directrix 的输入不是函数 f(x)。抛物线单结果直接命名；双焦点和多准线用 {命令(...)} 收集后 Element，不写 Focus(conic,索引) 或 Directrix(conic,索引)。索引不承诺左右/上下对应。已有输入焦点/准线时直接引用，不能覆盖上游输入；列表/冗余元素可按视图隐藏。
