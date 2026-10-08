# SOP: plane-helper — 平面与交线写法

输入：不共线三点，或点 P 与非零法向 nAxis，或参考平面 planeP。

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

写法注意：点加法向量写 PerpendicularPlane(P,n)，不写 Plane(P,n)。过 Q 平行于 planeP 写 Plane(Q,planeP)。面面 Intersect 返回线；平行/重合两面无唯一交线。xOyPlane 为内置坐标平面；其他面先显式定义。无限平面不是有限截面。
