# SOP: intersection — 求交与分支选择

适用：线线、线曲线、曲线曲线、线面或面面相交。前置：输入对象已定义，先判断结果类型、数量和存在区间。

片段：唯一交点。
<!-- example: intersect-single -->
```ggb
X = Intersect(lineAB, lineCD)
ShowLabel(X, true)
SetLabelMode(X, 1)
```

片段：直线与圆有两个交点，先收集再按题意选；输出名称不依赖自动命名。
<!-- example: intersect-multiple -->
```ggb
crossPts = {Intersect(lineAB, circleC)}
X1 = Element(crossPts, 1)
X2 = Element(crossPts, 2)
```

边界：
- 也可 Intersect(l,c,1/2)，索引从 1 起。索引不保证对应题意的“左/右、上/下、另一点”，须检查位置、已知点和运动分支。
- 与轴相交可引用 xAxis/yAxis；需要显式辅助线时先建再隐藏。不要手算交点后写死坐标。
- 一般函数数值求交可用 Intersect(f,g,xMin,xMax)，区间须由题意选择；不把多项式/圆锥曲线的索引策略无条件套给所有对象。
- 平行线无有限唯一交点；引擎可能仍建出显示 ?、坐标非有限的点，不能只凭对象名或 isDefined 判断成功。重合对象不提供唯一解。相切只有一个不同交点，不取不存在的第二点。
- 三维线面返回点、面面返回线、面与球返回圆/圆锥曲线；不能将所有结果当作点。
- 动态题需在允许范围内验证交点存在；不能悄悄缩小数学范围来掩盖无交点状态。
检查：所需结果存在且有定义；位于两输入对象上，分支符合题意；隐藏收集列表及不需要的中间对象。
