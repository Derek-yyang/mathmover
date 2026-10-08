# SOP: 3d-edges — 由邻接关系逐条连棱

适用：线框表达的棱柱、棱锥、棱台及其他多面体。前置：顶点已定义，已知面的边界顺序与顶点对应。

构造选择：
- n 边棱柱/棱台：下底循环边 + 上底循环边 + 对应侧棱，共 3n 条。
- n 边棱锥：底面循环边 + 锥顶到各底面顶点，共 2n 条。
- 一般多面体：逐面列边，对无向端点对去重；不把所有点两两连接，不把对角线当棱。

片段：四边棱柱的下底、上底与对应侧棱；同名端点须按题意替换。
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

片段：三角棱锥/四面体。
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

边界：
- 保持原子化 Segment，不以 Cube/Prism/Pyramid 实体替换线框；需要某个有限面时另外 Polygon。
- 棱显式设黑色实线，避免依赖引擎默认颜色；使用 SetColor(eAB,"Black") / SetLineStyle(eAB,0) 等逐条属性，不在输出中使用省略号或伪循环。
- 对角线单独命名并按用途设样式；真实棱不可“宁多勿少”。没有依据不按固定视角猜背面虚线。
检查：棱数正确、无重复端点对、无漏边及多余对角线；每条长度非零，题目关键棱可见。
