# SOP: curve-definition — 圆锥曲线定义写法

输入：中心 O、单位主轴向量 uAxis、有效半轴；抛物线分支输入焦点 F 和直线 d。

<!-- example: conic-ellipse -->
```ggb
lenA = 3
lenB = 2
focusDist = sqrt(lenA^2 - lenB^2)
Fleft = O - focusDist*uAxis
Fright = O + focusDist*uAxis
conicC = Ellipse(Fleft, Fright, lenA)
```

<!-- example: conic-hyperbola -->
```ggb
lenA = 2
lenB = 1
focusDist = sqrt(lenA^2 + lenB^2)
Fleft = O - focusDist*uAxis
Fright = O + focusDist*uAxis
conicC = Hyperbola(Fleft, Fright, lenA)
```

<!-- example: conic-parabola -->
```ggb
conicC = Parabola(F, d)
```

写法注意：Ellipse(Fleft,Fright,lenA) 的末参是长半轴；lenA>lenB>0。Hyperbola 的 lenA 是半实轴，焦距 sqrt(lenA^2+lenB^2)。抛物线写 Parabola(F,d)，F 不在 d 上。椭圆 lenA=lenB 时改用圆写法。方程可直接命名，如 conicC: x^2/9+y^2/4=1，系数按本题替换；不写成单值函数代替整个曲线。
