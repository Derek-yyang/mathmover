# SOP: 3d-frame — 向量坐标生成空间顶点

输入：基点 A、边向量 vx/vy/vz；棱锥分支输入投影 H、高 ht 和单位法向 nAxis。

<!-- example: frame-prism -->
```ggb
B = A + vx
D = A + vy
C = A + vx + vy
A1 = A + vz
B1 = B + vz
C1 = C + vz
D1 = D + vz
```

<!-- example: frame-pyramid -->
```ggb
S = H + ht*nAxis
```

写法注意：vx/vy/vz 引用已定义向量；长度和方向由构造方案确定，不强制整数或竖直侧棱。加向量生成的点保留动态依赖。**vx/vy/vz 是纯计算对象，按 view 3 隐藏**（`SetVisibleInView(vx, 3, false)`，三个都写）——留着它们，画布上就是三根指向坐标轴的箭头，抢视线也干扰取景判断。棱台对应顶点可写 S+k*(A-S)，各点共用同一比例 k。
