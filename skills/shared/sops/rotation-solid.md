# SOP: rotation-solid — 球、锥、柱与曲面截面写法

输入：球心 O 或轴端点 O/T、正半径 radiusR；截面分支另需 planeP。

<!-- example: solid-sphere -->
```ggb
sphereC = Sphere(O, radiusR)
SetColor(sphereC, "Blue")
SetFilling(sphereC, 0.15)
```

<!-- example: solid-cone-cylinder -->
```ggb
coneC = Cone(O, T, radiusR)
cylinderC = Cylinder(O, T, radiusR)
SetFilling(coneC, 0.15)
SetFilling(cylinderC, 0.15)
```

<!-- example: solid-sphere-section -->
```ggb
sectionC = Intersect(sphereC, planeP)
sectionO = Center(sectionC)
SetColor(sectionC, "Blue")
ShowLabel(sectionO, true)
```

写法注意：Cone(O,T,r) 中 O 是底心、T 是锥顶；Cylinder(O,T,r) 中二者是底心，轴端点互异。另有 Cone(baseCircle,height)/Cylinder(baseCircle,height)，不写 点,半径,高。锥/柱示例是两种选项，按题意择一。球面与平面非退化相交才取 Center(sectionC)；锥/柱斜截面不一定是圆。
