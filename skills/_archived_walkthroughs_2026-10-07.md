# 已退役的 walkthrough 范文归档（2026-10-07）

> v3 时代的「一题带教」完整范文，已被 shared/sops/ 模式卡片库（v4）替代。
> 保留作历史参考与内容溯源；prompt 装配器（expert_prompts.py v4）不再读取本文件。


---

## 原 function-expert/references/walkthrough.md

【完整范例】先看一道函数压轴题是怎么从题意变成指令流的。

题目：抛物线 f(x) = -x^2 + 2x + 3 经过平行四边形 ABCD 的顶点 A(0,3)、B(-1,0)、D(2,3)，
与 x 轴另一交点为 E。直线 l 过 E 且平分平行四边形面积（即过对角线交点 M），
与抛物线交于另一点 F。点 P 为直线 l 上方抛物线上一动点（横坐标 t），
构建三角形 PFE 观察其面积变化。

指令流：
MODE: 2D
SetAxesVisible(true, true)
SetGridVisible(true)
f(x) = -x^2 + 2x + 3
SetColor(f, "Black")
A = (0, 3)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
B = (-1, 0)
SetFixed(B, true)
ShowLabel(B, true)
SetLabelMode(B, 1)
D = (2, 3)
SetFixed(D, true)
ShowLabel(D, true)
SetLabelMode(D, 1)
E = Root(f, 2, 4)
SetColor(E, "Black")
SetPointSize(E, 4)
SetLabelMode(E, 1)
ShowLabel(E, true)
C = B + D - A
SetFixed(C, true)
ShowLabel(C, true)
SetLabelMode(C, 1)
polyABCD = Polygon(A, B, C, D)
SetFilling(polyABCD, 0.2)
SetColor(polyABCD, "Blue")
M = (A + C) / 2
SetFixed(M, true)
ShowLabel(M, true)
SetLabelMode(M, 1)
l = Line(E, M)
SetColor(l, "Green")
SetLineStyle(l, 2)
F = Intersect(l, f, 2)
SetColor(F, "Black")
SetPointSize(F, 4)
SetLabelMode(F, 1)
ShowLabel(F, true)
t = Slider(-0.5, 3, 0.05)
P = (t, f(t))
SetColor(P, "Red")
ShowLabel(P, true)
SetLabelMode(P, 1)
polyPFE = Polygon(P, F, E)
SetFilling(polyPFE, 0.3)
SetColor(polyPFE, "Red")

讲解：
- 题目给的每个点（A、B、D）都要建对象 + 三件套，一个都不能省。
- E 是"与 x 轴另一交点"：用 E = Root(f, 2, 4) 让引擎找零点——Root 返回的
  就是零点 (x₀, 0) 本身，直接赋值即可，不要手算 x=3；更不能写成
  (Root(f, 2, 4), 0)——Root 返回的是点不是数值，包一层坐标会建出未定义点
  并连坐下游（坑手册 §1）。
- 平行四边形的第四个顶点 C：用向量关系 C = B + D - A 交给引擎，
  对角线交点 M = (A + C) / 2 同理——几何关系全部写表达式。
- 直线 l 与抛物线的交点 F：用 Intersect(l, f, 2)（索引 2 取第二个交点），
  绝不解方程手算坐标。
- 动点 P：滑块 t 控制横坐标，纵坐标 f(t) 让引擎算。
- 题目涉及的封闭图形（平行四边形 ABCD、动态三角形 PFE）都用 Polygon + SetFilling。
- 复杂压轴题的指令流就是这些标准件的组合——按骨架顺序逐个落实，不要遗漏题目对象。


---

## 原 planar-geometry-expert/references/walkthrough.md

【完整范例】看一道平面几何轨迹题怎么写。

题目：A(0,0)、B(4,0)，动点 C 在以 A 为圆心、2 为半径的圆上运动。
M 为 BC 的中点，D 满足 MD ⊥ BC 且 MD = BC/2（D 在 BC 的垂线方向），
P 满足向量 AP = 2·向量 AD。观察 P 的轨迹。

指令流：
MODE: 2D
SetAxesVisible(true, true)
SetGridVisible(true)
A = (0, 0)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
B = (4, 0)
SetFixed(B, true)
ShowLabel(B, true)
SetLabelMode(B, 1)
pathC = Circle(A, 2)
SetLineStyle(pathC, 2)
SetColor(pathC, "Gray")
t = Slider(0, 1, 0.01)
C = Point(pathC, t)
SetColor(C, "Red")
ShowLabel(C, true)
SetLabelMode(C, 1)
M = Midpoint(B, C)
ShowLabel(M, true)
SetLabelMode(M, 1)
D = M + 0.5 * (-(y(B) - y(C)), x(B) - x(C))
ShowLabel(D, true)
SetLabelMode(D, 1)
SetColor(D, "Blue")
P = 2 * D - A
ShowLabel(P, true)
SetLabelMode(P, 1)
SetColor(P, "Blue")
polyABC = Polygon(A, B, C)
SetFilling(polyABC, 0.05)
polyBCD = Polygon(B, C, D)
SetFilling(polyBCD, 0.05)
segAD = Segment(A, D)
segDP = Segment(D, P)
segPB = Segment(P, B)

讲解：
- 动点在圆上：先画路径 Circle(A, 2) 并设灰色虚线（SetLineStyle 2），
  再 t = Slider(0, 1, 0.01) + C = Point(pathC, t) 让点沿路径运动。
- 中点用 Midpoint(B, C)——不要手算坐标。
- D 的垂直关系用向量表达式 D = M + 0.5 * (-(y(B) - y(C)), x(B) - x(C))
  直接交给引擎计算：把几何条件翻译成坐标运算，GeoGebra 会自动联动。
- P = 2 * D - A 同理，线性关系全部写表达式。
- 题目涉及的三角形用 Polygon 构建并轻填充；连线用 Segment。


---

## 原 conic-expert/references/walkthrough.md

【完整范例】看一道解析几何题怎么写。

题目：椭圆 x^2/4 + y^2 = 1，左顶点 A、下顶点 B。动点 M 在第一象限的椭圆弧上运动，
直线 MB 交 x 轴于 C，直线 MA 交 y 轴于 D（辅助坐标线交点），三角形 OCD 随 M 变化。

指令流：
MODE: 2D
SetAxesVisible(true, true)
SetGridVisible(true)
C_curve = Ellipse((-sqrt(3), 0), (sqrt(3), 0), 2)
SetColor(C_curve, "Black")
O = (0, 0)
SetFixed(O, true)
ShowLabel(O, true)
SetLabelMode(O, 1)
A = (-2, 0)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
B = (0, -1)
SetFixed(B, true)
ShowLabel(B, true)
SetLabelMode(B, 1)
V_right = (2, 0)
V_top = (0, 1)
SetVisibleInView(V_right, 1, false)
SetVisibleInView(V_top, 1, false)
arcM = Arc(C_curve, V_right, V_top)
t_m = Slider(0.01, 0.99, 0.01)
M = Point(arcM, t_m)
SetColor(M, "Red")
ShowLabel(M, true)
SetLabelMode(M, 1)
lineMB = Line(M, B)
SetColor(lineMB, "Blue")
lineMA = Line(M, A)
SetColor(lineMA, "Blue")
xAxis_line = Line((0, 0), (1, 0))
yAxis_line = Line((0, 0), (0, 1))
SetVisibleInView(xAxis_line, 1, false)
SetVisibleInView(yAxis_line, 1, false)
C = Intersect(lineMB, yAxis_line)
ShowLabel(C, true)
SetLabelMode(C, 1)
SetColor(C, "DarkGreen")
D = Intersect(lineMA, xAxis_line)
ShowLabel(D, true)
SetLabelMode(D, 1)
SetColor(D, "DarkGreen")
triOCD = Polygon(O, C, D)
SetColor(triOCD, "LightBlue")
SetFilling(triOCD, 0.3)
ShowLabel(triOCD, false)

讲解：
- 椭圆用参数式 Ellipse(焦点1, 焦点2, 长半轴)。焦点坐标写精确表达式
  (-sqrt(3), 0)——由 a=2, b=1 得 c=sqrt(a^2-b^2)=sqrt(3)，让 GeoGebra 自己求值，
  绝不要写 1.732。
- 弧上动点：先取弧的两个端点 V_right/V_top（设为视图外隐藏），arcM = Arc(曲线, 端点1, 端点2)，
  再滑块驱动 M = Point(arcM, t_m)。
- 与坐标轴的交点：先造隐藏的轴线 Line((0,0),(1,0))，再用 Intersect(直线, 轴线)
  求交点——交点永远用 Intersect，不要解方程手算坐标。
- 焦点若题目要求标注：直接 F1 = Focus(C_curve) 让引擎给出，再 SetPointSize 4 + SetLabelMode 1。
- 双曲线用 Hyperbola(焦点1, 焦点2, 实半轴)；抛物线用 Parabola(焦点, 准线)。


---

## 原 solid-geometry-expert/references/walkthrough.md

【完整范例】看一道立体几何题怎么写。

题目：棱长为 2 的正方体 ABCD-A1B1C1D1，E 为棱 BC 的中点，
F 是侧面 BB1C1C 内的动点，且 A1F 平行于平面 AD1E。

指令流：
MODE: 3D
A = (0, 0, 0)
B = (2, 0, 0)
C = (2, 2, 0)
D = (0, 2, 0)
A1 = (0, 0, 2)
B1 = (2, 0, 2)
C1 = (2, 2, 2)
D1 = (0, 2, 2)
E = Midpoint(B, C)
SetFixed(E, true)
ShowLabel(E, true)
SetLabelMode(E, 1)
SetColor(E, "Blue")
s1 = Segment(A, B)
s2 = Segment(B, C)
s3 = Segment(C, D)
s4 = Segment(D, A)
s5 = Segment(A1, B1)
s6 = Segment(B1, C1)
s7 = Segment(C1, D1)
s8 = Segment(D1, A1)
s9 = Segment(A, A1)
s10 = Segment(B, B1)
s11 = Segment(C, C1)
s12 = Segment(D, D1)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
SetColor(A, "Blue")
SetFixed(B, true)
ShowLabel(B, true)
SetLabelMode(B, 1)
SetColor(B, "Blue")
SetFixed(C, true)
ShowLabel(C, true)
SetLabelMode(C, 1)
SetColor(C, "Blue")
SetFixed(D, true)
ShowLabel(D, true)
SetLabelMode(D, 1)
SetColor(D, "Blue")
SetFixed(A1, true)
ShowLabel(A1, true)
SetLabelMode(A1, 1)
SetColor(A1, "Blue")
SetFixed(B1, true)
ShowLabel(B1, true)
SetLabelMode(B1, 1)
SetColor(B1, "Blue")
SetFixed(C1, true)
ShowLabel(C1, true)
SetLabelMode(C1, 1)
SetColor(C1, "Blue")
SetFixed(D1, true)
ShowLabel(D1, true)
SetLabelMode(D1, 1)
SetColor(D1, "Blue")
planeADE = Plane(A, D1, E)
SetVisibleInView(planeADE, -1, false)
M = (2, 0, 1)
SetVisibleInView(M, -1, false)
N = (2, 1, 2)
SetVisibleInView(N, -1, false)
pathF = Segment(M, N)
SetLineStyle(pathF, 2)
SetColor(pathF, "Red")
F = Point(pathF)
ShowLabel(F, true)
SetLabelMode(F, 1)
SetColor(F, "Red")
sF = Segment(A1, F)
SetLineStyle(sF, 2)
SetColor(sF, "Red")

讲解：
- 顶点全部手写精确坐标（棱长 2 的正方体从原点起建系最简），8 个顶点各做三件套 + 蓝色。
- 棱必须逐条 Segment 原子化连接（12 条），禁用 Cube/Prism 封装命令；
  棱保持默认黑色实线，不要 SetLineStyle。
- E 是"BC 的中点"——用 Midpoint(B, C) 让引擎算，不要手写 (2,1,0)。
- 定位用的辅助平面 Plane(A, D1, E) 构建后必须 SetVisibleInView(plane, -1, false) 隐藏。
- F 的轨迹：由几何条件（A1F ∥ 平面 AD1E）推导出轨迹是侧面内一条线段，
  端点 M(2,0,1)、N(2,1,2) 是推导结论，写坐标但设为隐藏，
  路径 Segment(M,N) 红色虚线，动点 F = Point(pathF)。
- 连接动点的线（A1F）用红色虚线 Segment。
- 旋转体：球 Sphere(球心, 点)、圆锥 Cone(中心, 半径, 高)、圆柱 Cylinder(中心, 半径, 高)；
  与坐标平面相交的交线用 Intersect(球, xOyPlane) 求并设黑色虚线。

