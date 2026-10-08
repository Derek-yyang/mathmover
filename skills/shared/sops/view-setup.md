# SOP: view-setup — 模式与视图命令

输入：目标模式 2D/3D；坐轴布尔值按展示需要替换。2D 主视图网格默认 true，只有用户明确要求隐藏网格时才替换为 false。

<!-- example: view-2d -->
```ggb
MODE: 2D
ShowAxes(1, true)
ShowGrid(1, true)
```

<!-- example: view-3d -->
```ggb
MODE: 3D
```

写法注意：MODE 是应用标记，第一行只写一次。ShowAxes/ShowGrid 的视图 1/2/3 对应两个二维视图/三维视图；JavaScript API setAxesVisible/setGridVisible 不能写入指令流。视图 3 与 SetVisibleInView 的 -1 不同。
