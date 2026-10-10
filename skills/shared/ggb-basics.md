# 通用 GGB 写法

以下写法每题必用，直接照写；不确定的命令名以「严格语法约束」清单为准。

- **MODE 行**：第一行只写一次，`MODE: 2D`；立体几何题写 `MODE: 3D`。
- **视图**：`ShowAxes(1, true)` 开坐轴、`ShowGrid(1, true)` 开网格（2D 开场默认开网格，仅用户明确要求隐藏时才写 false；坐轴按题意独立设置）。视图 1/2/3 分别对应两个二维视图与三维视图；`SetVisibleInView(obj, 视图, false)` 按视图隐藏纯计算对象，`-1` 不等于视图 3。
- **点**：`A = (sqrt(3), -1/2)`，常量写精确分数/根式，不写小数近似；三维点写 `(x, y, z)`。独立定点用 `SetFixed(A, true)` 锁定，驱动点不锁定。派生点保留原表达式（如 `M = Midpoint(B, C)`），不能把当前坐标抄成常量。
- **线**：`Segment(A, B)` 有限线段、`Line(A, B)` 无限直线、`Ray(A, B)` 单向射线、`Vector(A, B)` 向量——按题意选，别把有限画成无限。
- **标签**：`ShowLabel(A, true)` 显示标签，`SetLabelMode(A, 1)` 名称与值（按展示要求替换模式）。
- **样式**：`SetColor(f, "Red")` 颜色——主线 Black/Blue、辅助线 Gray、驱动点 Red、关系点 Blue；`SetLineStyle(f, 2)` 虚线（0 为实线）；`SetLineThickness(f, 3)` 线宽；`SetPointSize(A, 4)` 点大小；`SetFilling(poly, 0.3)` 填充透明度。
- **规矩**：以上都是输入栏命令，不是 JavaScript API（`setAxesVisible`、`setColor` 之类一律不能写入指令流）。属性行写在该对象定义之后，先定义后引用；名字避开题目已用名。
