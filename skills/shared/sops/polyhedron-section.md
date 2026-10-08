# SOP: polyhedron-section — 线框多面体的有限截面

适用：棱柱/棱锥/棱台被平面截出的有限多边形。前置：真实棱集及截平面已定义，几何体为凸多面体时采用本卡顺序。

构造选择：
1. 判断哪些有限棱与平面相交，使用 Segment 而不是无限 Line，排除仅延长线相交。
2. 保留有效交点；平面穿过顶点时合并同一位置，重合棱单独处理端点。
3. 沿各面上的交线邻接顺序排列截点，再 Polygon。不要按字母顺序/求交输出顺序连接。

片段：截平面穿过四边棱柱的四条侧棱，已确认各段都有一个交点。
<!-- example: section-prism -->
```ggb
U = Intersect(eAA1, cutPlane)
V = Intersect(eBB1, cutPlane)
W = Intersect(eCC1, cutPlane)
X = Intersect(eDD1, cutPlane)
sectionPoly = Polygon(U, V, W, X)
SetFilling(sectionPoly, 0.2)
SetColor(sectionPoly, "Blue")
ShowLabel(sectionPoly, false)
SetVisibleInView(cutPlane, -1, false)
```

边界：
- 片段不是“任意截面固定四点”：平面也可能切底棱/顶棱，交点数依位置变化。
- 只有点/线交触时不强造有面积的多边形；没有交点时不造未定义的截面。
- 动态截面可能改变拓扑，不能盲用固定截点列表；先分合法位置区间或针对状态分别构造。
- 线框不存在可求交的实体，不能写 Intersect(不存在的 Prism,plane)。若确有实体才可采用其求交结果。
- 非凸/多连通截面需单独分区域，不套单个凸多边形。
检查：截点均在有限棱和平面上，截面无自交且共面；面积/点数与位置一致，无重复交点。
