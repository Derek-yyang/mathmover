# SOP: function-object —— 函数定义 + 地标（顶点/零点/极值/对称轴）

触发：题目出现函数表达式（一次/二次/三角/一般函数），需要画函数图像。

片段（定义 + 设色）：
```
f(x) = -x^2 + 2x + 3
SetColor(f, "Black")
```

片段（顶点 + 对称轴，二次函数默认画）：
```
V = Vertex(f)
SetFixed(V, true)
ShowLabel(V, true)
SetLabelMode(V, 1)
SetColor(V, "Blue")
axisV = Line(V, V + (0, 1))
SetLineStyle(axisV, 2)
SetColor(axisV, "Gray")
```

片段（零点，见坑手册 §1）：
```
E = Root(f, 2, 4)
```

片段（极值点）：
```
Ex = Extremum(f, 1)
```

变体：
- 区间限制的函数：`f(x) = If(-1 <= x <= 3, -x^2 + 2x + 3)` 或 `Function(f, -1, 3)`。
- 多个函数对象：命名 f、g、h，各配设色。
- 三角函数直接写 `sin(x)`、`cos(x)`，GeoGebra 原生支持。

注意：
- 抛物线默认画顶点和对称轴（虚线弱色），除非题目明确不需要——顶点是函数题的"地标"。
- `Root(f, a, b)` 返回的是点不是数值（坑手册 §1 最高危），直接赋值使用，不要包坐标。
- 需要 x 轴截距的横坐标数值时：`x0 = x(Root(f, 2, 4))`。
