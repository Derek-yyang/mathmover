# SOP: curve-definition — 圆锥曲线与局部坐标

适用：由方程或几何参数构造椭圆、双曲线、抛物线。前置：确定中心/顶点、主轴方向及精确参数。

片段：椭圆的中心 O、单位主轴向量 uAxis 和半轴 lenA>lenB>0；示例常量需按题意替换。
<!-- example: conic-ellipse -->
```ggb
lenA = 3
lenB = 2
focusDist = sqrt(lenA^2 - lenB^2)
Fleft = O - focusDist*uAxis
Fright = O + focusDist*uAxis
conicC = Ellipse(Fleft, Fright, lenA)
SetColor(conicC, "Black")
```

片段：双曲线半实轴/半虚轴均为正。
<!-- example: conic-hyperbola -->
```ggb
lenA = 2
lenB = 1
focusDist = sqrt(lenA^2 + lenB^2)
Fleft = O - focusDist*uAxis
Fright = O + focusDist*uAxis
conicC = Hyperbola(Fleft, Fright, lenA)
```

片段：已有焦点 F 和准线 d。
<!-- example: conic-parabola -->
```ggb
conicC = Parabola(F, d)
SetColor(conicC, "Black")
```

边界：
- uAxis 必须是单位向量；中心平移、轴转向均通过 O/uAxis 表达。别把“横半轴”永远当长半轴。
- lenA=lenB 的椭圆退化为圆，使用 circle-tangent；双曲线的实轴和虚轴不要交换。
- 抛物线焦点不能在准线上；准线先定义为直线对象，不用未说明类型的字符串。
- 保持根式精确；允许引擎计算参数，不能因坐标含根号而改几何比例。
- 曲线名称不与题目点名冲突；需要区域限制/分支运动时转到相应动点卡。
检查：输入参数有效，曲线满足题给方程/条件；焦点间距、中心和轴向一致。
