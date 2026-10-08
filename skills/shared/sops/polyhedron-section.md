# SOP: polyhedron-section — 有限棱求交与截面多边形

输入：凸多面体真实棱段、截平面 cutPlane，以及去重后沿面邻接排好的截点顺序。示例已确定四条侧棱各有唯一交点。

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

写法注意：求交引用 Segment 棱对象，不能換成无限 Line。示例四点只用于当前拓扑，其他截面按有效棱和边界顺序替换；过顶点去重，重合棱处理端点。点/线交触不执行 Polygon。动态拓扑分状态处理。线框不是 Prism 实体，不能对不存在的实体求交。
