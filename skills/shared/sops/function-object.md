# SOP: function-object — 函数、定义域、零点、极值与切线

适用：一次/二次/一般函数及导数题。前置：确定解析式和数学定义域；题给常量与讨论参数分开。

片段：二次函数的一个示例，f 的系数按题意替换。
<!-- example: function-quadratic -->
```ggb
f(x) = -x^2 + 2*x + 3
SetColor(f, "Black")
V = Extremum(f)
ShowLabel(V, true)
SetLabelMode(V, 1)
axisV = Line(V, V + (0, 1))
SetLineStyle(axisV, 2)
E = Root(f, 2, 4)
```
区间 [2,4] 只隔离此示例的零点 3；本题必须重新选区间。

片段：已定义可微函数 f 时，按题意选切点横坐标。
<!-- example: function-calculus -->
```ggb
df = Derivative(f)
K = (1, f(1))
tangentK = Tangent(1, f)
```

边界：
- 函数 f(x) 的二次顶点用 Extremum(f)；Vertex 用于圆锥曲线等对象，不用 Vertex(f)。
- 多项式 Extremum(f) 可产生多个极值点；一般连续函数用 Extremum(f,xMin,xMax)。没有 Extremum(f,索引) 写法。
- Root(f) 的多项式多结果须收集/命名；Root(f,a,b) 返回一个零点对象，横坐标用 x(E)，不能包成 (Root(...),0)。
- 区间限制可 fPart=Function(f,xMin,xMax)。分段用 If；间断、分母零点、不可导点要分段处理，不能跨间断数值找极值。
- 区间最值还需比较允许的端点，不把局部极值当全局最值。
- 已知条件足以确定系数时先求精确系数；条件不足或题目讨论参数时保留参数。讨论参数才设滑块。
- 顶点/对称轴、导函数与切线仅在题意相关时展示，不给一次/三角函数强加二次地标。
检查：函数满足所有已知条件；零点/极值有定义；切线与函数在切点相切；定义域未被展示范围替代。
