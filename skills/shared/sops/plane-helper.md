# SOP: plane-helper —— 3D 定位平面与截面（Plane / Intersect 平面交线）

触发：题目出现"平面 α / 截面 / 点面距 / 线面平行垂直判定"需要的平面或交线对象。

片段（定位平面：三点定面，建出即隐藏）：
```
planeADE = Plane(A, D1, E)
SetVisibleInView(planeADE, -1, false)
```

片段（两平面交线，如截面与侧面）：
```
l_cross = Intersect(plane1, plane2)
SetColor(l_cross, "Blue")
```

片段（平面与坐标面交线，如球被 xOy 面所截）：
```
circle_cross = Intersect(sphere1, xOyPlane)
SetColor(circle_cross, "Black")
SetLineStyle(circle_cross, 2)
```

变体：
- 平面的可见表示（题目明确要画平面 α）：建出后不隐藏，但设轻填充
  `SetFilling(plane, 0.1)` + 弱色，避免整面糊住。
- 已知平面的法向量做平行平面：`Plane(A, normal_v)` 点+法向式。

注意：
- 纯判定用的定位平面一律建出即隐藏（hidden-helper 卡），这是 3D 视觉完整度的头号坑。
- xOyPlane / xOzPlane / yOzPlane 是内置对象，直接引用不用建。
- 截面交线用虚线/显著色按"答案还是辅助"定（aux-line 卡规则）。
