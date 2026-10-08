# SOP: plane-helper — 无限平面、定位与交线

适用：三点定面、法向定面、平行平面及空间求交。前置：三点不共线、法向量非零；区分计算平面和可见有限截面。

<!-- example: plane-three-points -->
```ggb
planeABC = Plane(A, B, C)
SetVisibleInView(planeABC, -1, false)
```

<!-- example: plane-normal -->
```ggb
planeP = PerpendicularPlane(P, nAxis)
planeParallel = Plane(Q, planeP)
```

<!-- example: plane-cross -->
```ggb
crossLine = Intersect(planeABC, planeP)
SetColor(crossLine, "Blue")
```

边界：
- 点+法向量用 PerpendicularPlane(P,n)，不写 Plane(P,n)。Plane(Q,planeP) 是过 Q 的平行平面。
- 平行/重合两平面无唯一交线；三点共线不能定唯一平面。
- 计算用无限平面隐藏；题目要求观察有限截面时构造截面多边形，见 polyhedron-section，不能拿整张无限平面代替。
- 球/锥/柱截面由对应曲面与平面求交；xOyPlane 是内置坐标平面，不假设所有坐标面都有同样预定义名称。
检查：平面满足给定点与法向/平行条件；交线同时位于两平面；隐藏只影响目标视图。
