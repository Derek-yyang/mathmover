# SOP: aux-line — 按用途设置线样式

适用：辅助高线、对称轴、连接线及主角直线。前置：先区分题目主体、解释性辅助、纯计算辅助。

<!-- example: auxiliary-line -->
```ggb
segAD = Segment(A, D)
SetLineStyle(segAD, 2)
SetColor(segAD, "Gray")
```

<!-- example: auxiliary-perpendicular -->
```ggb
perpD = PerpendicularLine(D, lineAB)
SetLineStyle(perpD, 2)
SetColor(perpD, "Gray")
```

边界：
- 主角线用实线及 Black/Blue；解释性辅助用灰虚线；纯计算对象隐藏，见 hidden-helper。
- 高线、角平分线或路径也可能是题目主体，不按对象类型一律虚化。
- 判断 Line/Segment/Ray 的无限、有限、单向范围，不能为了好看改对象类型。
- 三维“被遮挡的棱”与“辅助线”不是同一类；不要未经视角判断静态指定所有背面棱。
检查：属性紧随定义；线的范围及可见性符合题意，样式能区分用途。
