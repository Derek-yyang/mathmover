# SOP: rotation-solid — 球、圆锥、圆柱与截面

适用：题目含球、有限圆锥/圆柱。前置：球心/轴端点/半径来自题意，确定轴向和高度。

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
O 为圆锥底面中心、T 为锥顶；圆柱中 O/T 是两底面中心。此片段只演示两种选项，实际按题意择一。

<!-- example: solid-sphere-section -->
```ggb
sectionC = Intersect(sphereC, planeP)
sectionO = Center(sectionC)
SetColor(sectionC, "Blue")
ShowLabel(sectionO, true)
```

边界：
- 轴端点互异、半径>0。也可 Cone(baseCircle,height)/Cylinder(baseCircle,height)，不要写“点,半径,高”。
- 本体必须存在且可见；用轻填充避免遮挡内部关系。球心或轴端点若题目点名，显式建出并展示。
- 球面相交平面距球心<半径时才有非退化截面圆；相切为退化状态，外离无截面，不能盲用 Center。
- 任意斜截面不一定是圆；锥/柱截面按对象类型处理，不无条件取圆心。
- 球面运动不能随意限制成一个大圆；仅在题意要求圆路径时使用 moving-point-path。
检查：本体维度/轴向正确，高度为 Distance(O,T)；截面在平面和本体上，范围变化后类型仍合法。
