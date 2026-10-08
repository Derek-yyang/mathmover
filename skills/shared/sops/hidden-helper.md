# SOP: hidden-helper — 保留计算依赖，控制视图可见性

适用：仅用于计算的端点、替身轴线、定位平面及收集列表。前置：对象已定义，确认不是题目具名主体。

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

边界：
- 视图 1 为二维主视图，2 为第二二维视图，-1 为三维视图；-1 不表示所有视图。
- 同一对象在多个视图可见时逐个处理，不能只隐藏二维视图就认为三维已隐藏。
- 隐藏不删除；隐藏对象仍须有定义并维持下游依赖。
- 多结果收集列表若产生额外可见对象，检查列表和元素的实际显示，不能只隐藏列表名就假设全部消失。
检查：目标视图不可见，所需计算/几何对象仍存在；题目具名对象未被误隐藏。
