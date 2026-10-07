# SOP: rotation-solid —— 旋转体（球/锥/柱 + 截面交线）

触发：球、圆锥、圆柱、旋转体题目。

片段（球，球心+定半径）：
```
MODE: 3D
O_c = (1, 1, 1)
SetFixed(O_c, true)
ShowLabel(O_c, true)
SetLabelMode(O_c, 1)
sphere1 = Sphere(O_c, 2)
SetColor(sphere1, "Blue")
```

片段（球的截面圆）：
```
circle_cross = Intersect(sphere1, xOyPlane)
SetColor(circle_cross, "Black")
SetLineStyle(circle_cross, 2)
C_center = Center(circle_cross)
ShowLabel(C_center, true)
SetLabelMode(C_center, 1)
```

片段（圆锥/圆柱）：
```
cone1 = Cone((0, 0, 0), 2, 3)
cyl1 = Cylinder((0, 0, 0), 1, 4)
```

变体：
- 过球心与非球心的截面：截面圆心用 Center(circle_cross) 让引擎给，
  绝不手算截面圆心坐标。
- 球面上动点：先建截面圆或大圆路径，再 Point(path, t)（moving-point-path 卡）。
- 轴截面（矩形/三角形）：用 Polygon 建出关键剖面并淡填充。

注意：
- Sphere(球心, 半径) 或 Sphere(球心, 球面上一点) 两形态都合法，按题给条件选。
- 球的定位：球心坐标必须满足题目全部条件（如"与 xOy 面相切 ⟹ |z|=R"）——
  数学位置错误是 D 类真实 fail 的主因，建系前先把约束解清楚。
- 旋转体表面着色克制（Blue/默认），截面交线用虚线黑/灰。
