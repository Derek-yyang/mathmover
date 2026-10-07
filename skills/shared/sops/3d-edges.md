# SOP: 3d-edges —— 原子化连棱（逐条 Segment，禁封装命令）

触发：3D 多面体的棱（正方体 12 条、四面体 6 条、棱台侧棱等）。

片段（正方体 12 条棱全列）：
```
s1 = Segment(A, B)
s2 = Segment(B, C)
s3 = Segment(C, D)
s4 = Segment(D, A)
s5 = Segment(A1, B1)
s6 = Segment(B1, C1)
s7 = Segment(C1, D1)
s8 = Segment(D1, A1)
s9 = Segment(A, A1)
s10 = Segment(B, B1)
s11 = Segment(C, C1)
s12 = Segment(D, D1)
```

片段（四面体 6 条棱）：
```
s1 = Segment(A, B)
s2 = Segment(A, C)
s3 = Segment(A, D)
s4 = Segment(B, C)
s5 = Segment(B, D)
s6 = Segment(C, D)
```

变体：
- 只画题目研究涉及的可见棱系时也要保持原子化，宁多勿少。
- 侧面/底面对角线：同样是 Segment，可用虚线弱色（aux-line 卡）。

注意：
- 禁用 Cube/Prism/Pyramid 等封装命令——画出的是带面体的实体，遮挡内部结构
  且渲染不可控；一律逐条 Segment。
- 棱保持默认黑色实线，不要 SetLineStyle/SetColor。
- 每条棱独立一行，命名 s1、s2… 顺序走，不要跳号（排查时好对数）。
