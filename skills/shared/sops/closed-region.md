# SOP: closed-region — 多边形及有限区域

适用：三角形、多边形、动态面积比较或三维有限截面。前置：顶点已定义并按边界顺序排列。

<!-- example: polygon-region -->
```ggb
polyABCD = Polygon(A, B, C, D)
SetFilling(polyABCD, 0.15)
SetColor(polyABCD, "Blue")
ShowLabel(polyABCD, false)
```

边界：
- 四边形不能按任意点名顺序连，防止蝴蝶形自交；三维多边形顶点须共面。
- 动态多边形保留点依赖；共线/重合端点可能面积为零，不擅自排除题目允许状态。
- 只研究边界时逐条 Segment；Polyline 要闭合需重复首点。无须填面的三维线框不创建遮挡面的实体。
- Polygon 会自动创建边及标签，注意命名碰撞与多余边标签；定义后检查实际画面。
- 圆盘、扇形或曲线围成区域不应伪装成多边形；圆/扇形用对应构造，函数间面积按题意处理。
检查：顶点顺序、共面性、闭合与面积符合题意；透明度不遮挡主对象，动态关系保留。
