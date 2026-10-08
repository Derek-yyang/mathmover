# GeoGebra 指令坑手册（实证版）

四个专家 skill 共用。每条都是实测炸过的坑（GeoGebra 引擎逐条验证过的真实行为，
不是理论推断）。生成指令流前先过一遍，尤其是 §1。

## 1. Root() 返回的是"点"，不是数值 ⚠ 最高危

`Root(f, a, b)` 返回零点对象——坐标为 (x₀, 0) 的**点**，不是标量 x₀。
把它再包一层 `(…, 0)` 等于把"点"当坐标用，GeoGebra 不报错，静默建出未定义点 (?,?)，
所有依赖它的对象连坐失效（真实案例：一处写错，E、l、F、多边形 4 个对象静默消失）。

- 错误：`E = (Root(f, 2, 4), 0)`  ← E=(?,?)，下游 Line(E,M)、Intersect、Polygon 全部连坐
- 正确：`E = Root(f, 2, 4)`       ← Root 返回的点本身就是零点 (x₀, 0)，直接赋值
- 需要标量横坐标：`x0 = x(Root(f, 2, 4))`
- 两个零点都要：`n = Root(f)` 会建出 n_1、n_2 两个点（注意这个自动命名）

## 2. 未定义对象静默失败，且会连坐

求交失败（平行/相切、索引超出交点个数）、区间内无零点、对未定义对象做运算，
都不会报错，只会建出 (?,?) 或干脆不建对象，下游引用它的命令全部静默失效。
所以：构造每个对象前确认它的输入都已定义；交点个数没把握就不要盲写索引。

## 3. 属性命令返回 false ≠ 失败

SetColor / ShowLabel / SetLabelMode / SetPointSize / SetFilling / SetFixed /
SetLineStyle / SetVisibleInView 即使成功也返回 false。
不要拿它们的返回值判断成败，自查时更不要把它们的 false 统计为错误。

## 4. evalCommandGetLabels 会谎报成功

引擎回放时执行失败也可能返回标签。对象到底建没建，以 getAllObjectNames()
的差集为准，不能信返回标签。

## 5. Polygon 自动占用小写字母名

Polygon(A, B, C, D) 会自动生成边对象 a、b、c、d…。
不要再用这些小写名当别的对象名，会撞名。

## 6. 垂线命令参数顺序

PerpendicularLine(点, 直线)——点在前、直线在后。写反建出来的是另一条线甚至未定义。

## 7. 属性命令写在定义行之后

"先 SetColor 后定义"会静默返回 false。每个对象都是定义行紧跟属性行；
即使后端有重排兜底，也按顺序写。

## 8. Intersect 索引从 1 开始

`Intersect(曲线, 直线, 2)` 取第二个交点。只有一个交点时不写索引；
交点个数不确定时先确认（联立次数/几何位置），不要盲写索引 2。

## 9. 对象存在、isDefined 为真仍不足以证明点有效

在 SOP 回归中，平行线的 Intersect 返回了名为 X 的 point；isDefined(X) 为真，
但 getValueString(X) 显示 `X = ?`，getXcoord/getYcoord 为非有限值。
有效性应综合对象存在、显示值不含未定义标记，以及点坐标为有限数。
属性命令返回值和对象名称均不能代替这项检查。

## 10. 输入栏命令与 JavaScript API 不是同一套接口

`setAxesVisible`、`setGridVisible`、`setLabelStyle` 是 JavaScript API，不能首字母大写后作为输入命令。
输入栏分别用 `ShowAxes(1,true)`、`ShowGrid(1,true)`、`SetLabelMode(A,0)`。
平行平面用 `Plane(P,planeP)`，不使用 `ParallelPlane`；线宽用 `SetLineThickness`。
ShowAxes/ShowGrid 的三维视图编号为 3；SetVisibleInView 的三维视图编号为 -1，不能混用。

不能仅因为命令以 Set/Show 开头就忽略失败；视图、标签和样式须检查实际状态。
