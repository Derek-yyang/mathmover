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

写法注意：vx/vy/vz 引用已定义向量；长度和方向由构造方案确定，不强制整数或竖直侧棱。加向量生成的点保留动态依赖。棱台对应顶点可写 S+k*(A-S)，各点共用同一比例 k。
