# SOP: hidden-helper —— 隐藏辅助对象（SetVisibleInView 兜结构）

触发：为构造而存在的对象——弧端点、轴线替身、推导出的轨迹端点、定位平面、结构点。

片段（隐藏点）：
```
V_right = (2, 0)
SetVisibleInView(V_right, 1, false)
```

片段（隐藏直线）：
```
xAxis_line = Line((0, 0), (1, 0))
SetVisibleInView(xAxis_line, 1, false)
```

片段（隐藏平面，3D）：
```
planeADE = Plane(A, D1, E)
SetVisibleInView(planeADE, -1, false)
```

变体：
- 3D 里视图参数 -1 表示所有视图；2D 用 1。
- 隐藏对象也可能需要标签隐藏，但既然本体不可见，标签行通常整个省略。

注意：
- 隐藏 ≠ 删除：这些对象承担计算/引用职能，必须建出来，只是不给用户看。
- 每个隐藏对象独立一行 SetVisibleInView，不要漏——漏隐藏的辅助对象会污染画面
  （判分里的"视觉完整度"项）。
- 别把题目主角误隐藏：隐藏名单在动手前列一下，只隐藏纯结构性对象。
