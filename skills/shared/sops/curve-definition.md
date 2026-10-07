# SOP: curve-definition —— 圆锥曲线精确参数定义

触发：题目给出椭圆/双曲线/抛物线的方程或几何参数（焦点、顶点、离心率等）。

片段（椭圆，中心+顶点式）：
```
C_curve = Ellipse((-sqrt(3), 0), (sqrt(3), 0), 2)
SetColor(C_curve, "Black")
```

片段（双曲线）：
```
C_curve = Hyperbola((-sqrt(5), 0), (sqrt(5), 0), 2)
SetColor(C_curve, "Black")
```

片段（抛物线，焦点+准线）：
```
d = Line((0, -2), (1, -2))
C_curve = Parabola((0, 2), d)
SetColor(C_curve, "Black")
```

片段（圆）：
```
C_circle = Circle((0, 0), 2)
SetColor(C_circle, "Black")
```

变体：
- 由标准方程反推参数：x^2/4 + y^2 = 1 ⟹ a=2, b=1, c=sqrt(a^2-b^2)=sqrt(3)，
  焦点写 `(-sqrt(3), 0)` 让引擎自己求值。
- 开口向左/右的抛物线：焦点与准线相应旋转（焦点 (2,0)、准线 x = -2 即 Line((-2,0),(-2,1))）。

注意：
- 焦点/半轴长度含根号时写精确表达式（sqrt、分数），绝不能写 1.732 这类小数近似。
- 曲线命名避免与点名冲突（C_curve、C_circle 加后缀是安全做法）。
- 抛物线的准线必须先建直线对象再传入 Parabola，不能内联写方程字符串。
