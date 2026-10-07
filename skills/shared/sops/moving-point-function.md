# SOP: moving-point-function —— 函数动点（横坐标滑块 + 纵坐标引擎算）

触发：动点沿函数/曲线运动，题目给了横坐标参数（"横坐标为 t 的点 P"）。

片段：
```
t = Slider(-0.5, 3, 0.05)
P = (t, f(t))
SetColor(P, "Red")
ShowLabel(P, true)
SetLabelMode(P, 1)
```

变体：
- 动点在抛物线（当作 conic 对象建的）上：用 moving-point-path 卡 `Point(C_curve, t)`。
- 动点在直线上：直接 `(t, k*t + b)` 或 `Point(line, t)` 皆可，优先写坐标表达式。
- 需要第二个关联点（如"过 P 作垂线交 x 轴于 Q"）：`Q = (t, 0)` + `Segment(P, Q)`。

注意：
- 滑块范围覆盖题目给的自变量定义域；端点会退化（三角形面积 0 等）的题，范围两端各留一点余量。
- 纵坐标永远写 f(t) 让引擎算，绝不手算。
- 滑块名用小写 t、t_m、t_2 这类，不要与大写点名冲突。
