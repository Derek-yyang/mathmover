# SOP: hidden-helper — 按视图隐藏计算对象

输入：已定义、需要隐藏的计算对象及目标视图。

<!-- example: hidden-2d -->
```ggb
helperAxis = Line((0, 0), (1, 0))
SetVisibleInView(helperAxis, 1, false)
ShowLabel(helperAxis, false)
```

<!-- example: hidden-3d -->
```ggb
helperPlane = Plane(A, B, C)
SetVisibleInView(helperPlane, -1, false)
ShowLabel(helperPlane, false)
```

写法注意：SetVisibleInView 的 1/2/-1 分别为二维主视图/第二二维视图/三维视图，-1 不表示所有视图。多视图可见时分别设置。隐藏不删除对象或依赖。多结果列表与元素的可见性分别处理，不能假设隐藏列表名就隐藏所有输出。
