# SOP: 3d-edges — 逐条 Segment 连棱

输入：按邻接关系确定的顶点与棱端点对；下面分别演示四边棱柱和三角棱锥。

<!-- example: edges-prism -->
```ggb
eAB = Segment(A, B)
SetColor(eAB, "Black")
SetLineStyle(eAB, 0)
eBC = Segment(B, C)
SetColor(eBC, "Black")
SetLineStyle(eBC, 0)
eCD = Segment(C, D)
SetColor(eCD, "Black")
SetLineStyle(eCD, 0)
eDA = Segment(D, A)
SetColor(eDA, "Black")
SetLineStyle(eDA, 0)
eA1B1 = Segment(A1, B1)
SetColor(eA1B1, "Black")
SetLineStyle(eA1B1, 0)
eB1C1 = Segment(B1, C1)
SetColor(eB1C1, "Black")
SetLineStyle(eB1C1, 0)
eC1D1 = Segment(C1, D1)
SetColor(eC1D1, "Black")
SetLineStyle(eC1D1, 0)
eD1A1 = Segment(D1, A1)
SetColor(eD1A1, "Black")
SetLineStyle(eD1A1, 0)
eAA1 = Segment(A, A1)
SetColor(eAA1, "Black")
SetLineStyle(eAA1, 0)
eBB1 = Segment(B, B1)
SetColor(eBB1, "Black")
SetLineStyle(eBB1, 0)
eCC1 = Segment(C, C1)
SetColor(eCC1, "Black")
SetLineStyle(eCC1, 0)
eDD1 = Segment(D, D1)
SetColor(eDD1, "Black")
SetLineStyle(eDD1, 0)
```

<!-- example: edges-tetrahedron -->
```ggb
eAB = Segment(A, B)
SetColor(eAB, "Black")
SetLineStyle(eAB, 0)
eBC = Segment(B, C)
SetColor(eBC, "Black")
SetLineStyle(eBC, 0)
eCA = Segment(C, A)
SetColor(eCA, "Black")
SetLineStyle(eCA, 0)
eSA = Segment(S, A)
SetColor(eSA, "Black")
SetLineStyle(eSA, 0)
eSB = Segment(S, B)
SetColor(eSB, "Black")
SetLineStyle(eSB, 0)
eSC = Segment(S, C)
SetColor(eSC, "Black")
SetLineStyle(eSC, 0)
```

写法注意：每个端点对单独 Segment，SetColor/SetLineStyle 紧随定义。n 边棱柱/棱台展开为上下底循环边和侧棱共 3n 条，n 边棱锥展开为底边与锥顶连线共 2n 条。端点名按实际邻接替换；其他多面体逐边展开，不输出伪循环或省略号。需要有限面时另外 Polygon。
