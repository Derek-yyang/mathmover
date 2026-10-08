# SOP: fixed-point — 定点与派生点的属性写法

输入：独立点的精确坐标，或已定义的上游点 B、C。

<!-- example: fixed-independent -->
```ggb
A = (sqrt(3), -1/2)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
SetColor(A, "Blue")
```

<!-- example: fixed-derived -->
```ggb
M = Midpoint(B, C)
ShowLabel(M, true)
SetLabelMode(M, 1)
SetColor(M, "Blue")
```

写法注意：三维坐标用 (x,y,z)，允许分数/根式。SetFixed 用于独立定点；派生点保留原表达式，不能复制当前坐标，驱动点不锁定。标签模式 1 为名称与值，按展示要求替换。
