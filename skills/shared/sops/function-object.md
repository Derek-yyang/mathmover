# SOP: function-object — 零点、极值与切线写法

输入：解析式 f(x)、合法定义域或隔根区间；切线分支需要可微函数。

<!-- example: function-quadratic -->
```ggb
f(x) = -x^2 + 2*x + 3
V = Extremum(f)
axisV = Line(V, V + (0, 1))
E = Root(f, 2, 4)
```

<!-- example: function-calculus -->
```ggb
df = Derivative(f)
K = (1, f(1))
tangentK = Tangent(1, f)
```

写法注意：二次函数顶点用 Extremum(f)，不能 Vertex(f)。多项式 Extremum(f) 可有多结果，用 {Extremum(f)} 承接后 Element；不存在 Extremum(f,索引)。一般函数可 Extremum(f,xMin,xMax)。Root(f,a,b) 返回点，横坐标取 x(E)，不能写 (Root(...),0)；Root(f) 的多结果同样承接，无实根时不引用结果。闭区间限制可 Function(f,xMin,xMax)，开区间/分段用 If(条件,表达式)。Tangent(横坐标,f) 的首参是数值。示例 [2,4] 仅隔离零点 3，需替换。
