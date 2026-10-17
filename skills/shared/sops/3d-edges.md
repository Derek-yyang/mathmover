# SOP: 3d-edges — 逐条 Segment 连棱

输入：按邻接关系确定的顶点与棱端点对；下面分别演示四边棱柱和三角棱锥。

<!-- example: edges-prism -->
```ggb
eAB = Segment(A, B)
eBC = Segment(B, C)
eCD = Segment(C, D)
eDA = Segment(D, A)
eA1B1 = Segment(A1, B1)
eB1C1 = Segment(B1, C1)
eC1D1 = Segment(C1, D1)
eD1A1 = Segment(D1, A1)
eAA1 = Segment(A, A1)
eBB1 = Segment(B, B1)
eCC1 = Segment(C, C1)
eDD1 = Segment(D, D1)
```

<!-- example: edges-tetrahedron -->
```ggb
eAB = Segment(A, B)
eBC = Segment(B, C)
eCA = Segment(C, A)
eSA = Segment(S, A)
eSB = Segment(S, B)
eSC = Segment(S, C)
```

写法注意：每个端点对单独 Segment。**颜色与线型不必写**——线段默认就是黑色实线（实测 `getColor` 为 `#000000`、线型 0，写 `SetColor(..., "Black")` 与 `SetLineStyle(..., 0)` 属空转，只会把指令数翻倍）；要写的是非默认的那些（辅助线灰虚线、驱动点红等）。n 边棱柱/棱台展开为上下底循环边和侧棱共 3n 条，n 边棱锥展开为底边与锥顶连线共 2n 条。端点名按实际邻接替换；其他多面体逐边展开，不输出伪循环或省略号。需要有限面时另外 Polygon。
