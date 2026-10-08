# SOP: view-setup — 视图开场

适用：所有指令流；本卡只在开头使用一次。
前置：根据题目对象所在空间选择 2D / 3D；卡片中的 MODE 是应用标记，不是 GeoGebra 命令。

<!-- example: view-2d -->
```ggb
MODE: 2D
SetAxesVisible(true, true)
SetGridVisible(true)
```

<!-- example: view-3d -->
```ggb
MODE: 3D
```

边界：
- 其他卡片不得重复 MODE 或重新开场。3D 模式由应用切换视图，不能用二维视图命令代替。
- 是否显示坐轴和网格按题目用途调整；隐藏坐轴不能删除构造依赖。
检查：只有一个 MODE，且在第一行；对象维数与模式一致。
