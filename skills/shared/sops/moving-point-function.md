# SOP: moving-point-function — 坐标参数驱动点

输入：已有函数 f、合法参数范围；可选投影分支以 x 轴为目标。

<!-- example: motion-function -->
```ggb
t = Slider(-1, 2, 0.05)
SetValue(t, 0.5)
P = (t, f(t))
ShowLabel(P, true)
SetLabelMode(P, 1)
SetColor(P, "Red")
Q = (t, 0)
segPQ = Segment(P, Q)
```

写法注意：Slider 的范围、步长、初值需替换，点坐标引用同一参数。Q=(t,0) 和 segPQ 仅是投影选项。开区间/间断点可 If(合法条件,坐标表达式) 控制定义，不用滑块端点假装开区间。一般参数点用 (x(t),y(t)) 或 (x(t),y(t),z(t))，t 不一定是横坐标。驱动点不 SetFixed。
