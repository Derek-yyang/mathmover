# SOP: fixed-point — 独立定点与关系派生点

适用：题给坐标点、确定的顶点/圆心、由关系构造的具名点。
前置：判断点是独立常量、关系派生点，还是可动点；具体坐标必须来自题意。

片段：独立定点的示例坐标须替换为本题精确坐标。
<!-- example: fixed-independent -->
```ggb
A = (sqrt(3), -1/2)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
SetColor(A, "Blue")
```

片段：已有 B、C 时，用关系建点，保留依赖。
<!-- example: fixed-derived -->
```ggb
M = Midpoint(B, C)
ShowLabel(M, true)
SetLabelMode(M, 1)
SetColor(M, "Blue")
```

边界：
- 三维点使用 (x,y,z)，同样允许精确根式。不要为凑整数改变长度/角度。
- 独立定点锁定；驱动动点不锁定。关系派生点本来依赖上游对象，不用复制当前坐标来“固定”。
- 派生点是否可选与是否随动是两回事；SetFixed 不应被当成切断数学依赖的工具。
- 纯计算点可隐藏；题目点名或解释关键关系的点须保留可见标签。
检查：定点不能误拖，派生点随上游更新，坐标和题目名称对应。
