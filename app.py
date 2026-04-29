import os
import json
import base64
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import google.generativeai as genai
from dotenv import load_dotenv
from flask_cors import CORS
from supabase import create_client, Client
import openai
import requests

# 加载环境变量
load_dotenv()

app = Flask(__name__)
CORS(app, origins=["https://www.mathmover.top"])

# 初始化 Supabase
SUPABASE_URL = os.getenv('SUPABASE_URL')
# 使用 Service Role Key 以绕过 RLS (Row Level Security) 限制，确保后端能读取所有用户的配置
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Warning: Supabase credentials (URL or SERVICE_ROLE_KEY) missing in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

# 默认 Gemini 配置
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)
    default_model = genai.GenerativeModel('gemini-3-flash-preview')

# --- Prompt Definitions (保留原有的 Prompt) ---
ROUTER_PROMPT = """
你是一个数学题目分类器。请根据图片内容，判断题目属于以下哪一类，并仅返回对应的字母类别代码（A/B/C/D）。

分类标准：
A：函数与图像（一次函数、开口向上/向下的二次函数（抛物线）、三角函数、导数、一般函数）
B：平面几何（圆、多边形、角平分线、平面向量）
C：解析几何（椭圆、双曲线、开口向左/向右的抛物线、圆锥曲线）
D：立体几何（正方体、四面体、空间动点、球、旋转体）

要求：
- 请严格以 JSON 格式返回，不要包含任何 markdown 格式化（如 ```json ... ```）。
- 格式如下：
{"category": "A", "reason": "这里写你的解释..."}
- category 只能是 A、B、C 或 D。
"""

PROMPT_FUNCTION = """
你是一位函数与图像专家。请生成 GeoGebra 指令来绘制题目中的函数图像。
**输出第一行必须是**: `MODE: 2D`
 "在开始构建前，先执行以下判断逻辑：\\n"
    "1. **图文协同模式 (Scenario: With Diagram)**: \\n"
    "   - 当图片包含函数配图时，执行 **“拓扑看图，参数看文”**。\\n"
    "   - 看图 (Topology): 决定函数图像的大致形状与走势（如开口向上抛物线、周期波动正弦、单调递增直线）；注意：定义域、极值点、零点等关键特征必须严格遵循文字描述。\\n"
    "   - 看文 (Parameters): 决定具体数值。例如: 解析文字中的解析式 `f(x)=x^2-4` 或斜率 `k=2`，不要试图通过测量图片像素来猜测数值。\\n"
    "2. **纯文重建模式 (Scenario: Text Only)**\\n"
    "   - 当图片仅含文字描述（无函数配图）时，执行 **“标准构建”**。\\n"
    "   - 依据数学定义建立最典型的标准模型。例如: 提到“一次函数”且无坐标, 默认建立斜率为1、截距为0的直线 `y=x`。\\n\\n"

### 构建策略
1. **原则**:
   - 每个静态点定义后，**必须**执行三步操作：
     1. **锁定**: `SetFixed(A, true)`。
     2. **显标签**: `ShowLabel(A, true)`。
     3. **显名+坐标**: `SetLabelMode(A, 1)`。
   - 不要出现“SetVisibleInView(xAxis, 1, false)”和“SetVisibleInView(yAxis, 1, false)”
   - **不要在 GeoGebra 面板上出现任何文字说明**
   - 禁用Zoom in和Zoom out
   - 有动点一定一定要设置slider
   - 如果有封闭图形一定一定要适当设置填充颜色（SetFilling），透明度可设为 0.2–0.4
   - 关于 GeoGebra 角度显示的最终规则：在所有题目和场景中，默认所有需要显示的角都小于180度。一律不添加 SetAngleRange 命令，只需生成：角度名 = Angle(点1, 顶点, 点2)
   - 主从滑块联动：若题目描述里出现“主从”“联动”等题意，务必用 Slider 构建主从滑块，主滑块控制整体变化，从滑块依赖主滑块的输出作为取值范围。
2. **坐标系与视图**:
   - 默认显示坐标轴和网格: `SetAxesVisible(true, true)`, `SetGridVisible(true)`。
3. **函数构建**:
   - **显式函数**: 若 OCR 识别出 `f(x) = ...`，直接输出。
   - **参数反求**: 若题目给出顶点、零点、导数等信息，请推导并输出确定的函数解析式（如 `f(x) = x^2 - 2x + 1`）。
   - **定义域限制**: 若有定义域（如 `x > 0`），使用 `Function(f, xMin, xMax)` 截取。
4. **关键点标记**:
   - 自动计算并标记：零点、极值点、拐点、交点。
   - 交点定义必须用代数公式显式计算坐标，禁止使用 Intersect 函数；例如：  
     x_c = (3 - k - sqrt((k - 3)^2 + 8)) / 2  
     x_d = (3 - k + sqrt((k - 3)^2 + 8)) / 2  
     C = (x_c, f(x_c))  
     D = (x_d, f(x_d))
   - 样式: `SetColor(P, "Black")`, `SetPointSize(P, 4)`, `SetLabelMode(P, 1)`。
5. **动点与交互**:
   - 若有点 P 在函数上运动，使用 `t = Slider(xMin, xMax, 0.1)` -> `P = (t, f(t))`。
   - 样式: `SetColor(P, "Red")`, `ShowLabel(P, true)`, `SetLabelMode(P, 1)`。
   - **slider参数设计原则**：
     - **完整性**：参数范围必须能覆盖所有可能的几何情况。
     - **对称性**：若图形或代数结构具有对称性，参数范围应设计成对称形式，如 [−a,a]。
     - **可观察性**：范围不能过小，应至少能展示交点产生、临界变化、渐近趋势等过程。
     - **连续性**：步长适中，保证动画平滑，便于观察轨迹。
     - **Slider 指令格式**：所有 Slider 指令统一使用简化格式：
       t = Slider(最小值, 最大值, 步长)。禁止出现带 5 个参数的完整格式，如 t = Slider(0.01, 0.99, 0.01, 1, true) 
6. **辅助构造**:
   - 若有辅助线（如垂线、平分线），使用 `Line(A, B)` 或 `Segment(A, B)`。
   - 样式: `SetLineStyle(L, "Dashed")`, `SetColor(L, "Gray")`。
   - 理解题目图片、题干文字和各小问文字，如果题意中有对封闭图形（如三角形、平行四边形等等）的描述，**务必**用 Polygon 构建对应封闭区域后，执行 `SetFilling(poly, 0.2)`（或根据题意自选浅色），透明度可设为 0.2–0.4；若仅需描边，则改用 `SetLineStyle(poly, "Dashed")` 并 `SetColor(poly, "Gray")`。
### 严格语法约束
- 对象: Point, Slider, Function, Intersect, Segment, Line, Polygon.
- 属性: SetColor, SetLineStyle, SetFixed, SetLabelMode, ShowLabel, SetFilling.
"""

PROMPT_GEOMETRY = """
你是一位平面几何专家。请生成 GeoGebra 指令来构建题目中的几何图形。
**输出第一行必须是**: `MODE: 2D`
 "在开始构建前，先执行以下判断逻辑：\\n"
    "1. **图文协同模式 (Scenario: With Diagram)**: \\n"
    "   - 当图片包含几何配图时，执行 **“拓扑看图，参数看文”**。\\n"
    "   - 看图 (Topology): 决定静态定点的相对位置与形状结构（如定点P在第一象限，图示是圆则画圆）；注意：动点的运动范围与轨迹逻辑必须严格遵循文字描述。\\n"
    "   - 看文 (Parameters): 决定具体数值。例如: 解析文字中的半径 `r=3` 或边长 `AB=2`，不要试图通过测量图片像素来猜测数值。\\n"
    "2. **纯文重建模式 (Scenario: Text Only)**\\n"
    "   - 当图片仅含文字描述（无几何配图）时，执行 **“标准构建”**。\\n"
    "   - 依据数学定义建立最典型的标准模型。例如: 提到“正三角形”且无坐标, 默认建立以底边中点为原点的正三角形。\\n\\n"

### 构建策略
1. **原则**:
   - **不要在 GeoGebra 面板上出现任何文字说明**
   - 角度显示的规则：默认展示较小角度
   - 禁止定义向量，如 `v = (1, 2)`。
2. **智能建系**:
   - 观察图形对称性，建立最简便的直角坐标系（如以底边中点或直角顶点为原点）。
   - 根据题目边长、角度计算所有顶点的精确坐标。
3. **图形构建**:
   - **多边形**: 使用 `poly1 = Polygon(A, B, C...)` 构建闭合图形。
   - **圆**: 使用 `Circle(O, R)` 或 `Circle(O, A)`。
4. **定点锁定**:
   - 所有固定顶点必须执行: `SetFixed(P, true)`, `ShowLabel(P, true)`, `SetLabelMode(P, 1)`。
5. **分析动点并构建动点 (Point Motion)**:
   - 第一步：深度理解题意，题意中出现的动点，后续都要构建。
   - 动点: 若有点在边上运动，使用 `P = Point(Segment(A,B))`。
   - **动点样式统一**: 统一用红色和蓝色
   - 每个动点定义后，**必须**执行两步操作(动点一定不要SetFixed)：
    1. **显标签**: `ShowLabel(P, true)`。
    2. **显名+坐标**: `SetLabelMode(P, 1)`。
   - **滑块驱动 (Slider Driven)**:
     - 定义滑块: `t = Slider(0, 1, 0.01)` (0代表边起点，1代表边终点)。
     - 绑定动点: `M = Point(Segment(A,B), t)`。
   - **slider参数设计原则**：
     - **完整性**：参数范围必须能覆盖所有可能的几何情况。
     - **对称性**：若图形或代数结构具有对称性，参数范围应设计成对称形式，如 [−a,a]。
     - **可观察性**：范围不能过小，应至少能展示交点产生、临界变化、渐近趋势等过程。
     - **连续性**：步长适中，保证动画平滑，便于观察轨迹。
     - **Slider 指令格式**：所有 Slider 指令统一使用简化格式：
       t = Slider(最小值, 最大值, 步长)。禁止出现带 5 个参数的完整格式，如 t = Slider(0.01, 0.99, 0.01, 1, true) 
6. **辅助构造**:
   - 垂线、中线、角平分线：使用 `Segment`, `Midpoint`, `AngleBisector` 等指令。
   - 动点的路径，可以用虚线表示，例如：直线路径可以是l: Segment((1,1), (5,5)), SetLineStyle(l, 2)`；圆路径可以是 c: Circle((0,0), 3), SetLineStyle(c, 2)。

### 严格语法约束
- 对象: Point, Slider, Polygon, Circle, Segment, Line, Angle, AngleBisector, Midpoint, Intersect.
- 属性: SetColor, SetFilling, SetLineStyle, SetFixed, SetLabelMode, ShowLabel.
"""

PROMPT_ANALYTIC = """
你是一位解析几何专家。请生成 GeoGebra 指令来精确绘制圆锥曲线。
**输出第一行必须是**: `MODE: 2D`
"在开始构建前，先执行以下判断逻辑：\\n"
    "1. **图文协同模式 (Scenario: With Diagram)**: \\n"
    "   - 当图片包含几何配图时，执行 **“拓扑看图，参数看文”**。\\n"
    "   - 看图 (Topology): 决定静态定点的相对位置与形状结构（如定点P在第一象限，图示是椭圆则画椭圆）；注意：动点的运动范围与轨迹逻辑必须严格遵循文字描述。\n"
    "   - 看文 (Parameters): 决定具体数值。例如: 解析文字中的方程 `x^2/4+y^2=1` 或边长 `AB=2`，不要试图通过测量图片像素来猜测数值。\\n"
    "2. **纯文重建模式 (Scenario: Text Only)**\\n"
    "   - 当图片仅含文字描述（无几何配图）时，执行 **“标准构建”**。\\n"

### 构建策略
1. **原则**:
   - 每个静态点定义后，**必须**执行三步操作：
     1. **锁定**: `SetFixed(A, true)`。
     2. **显标签**: `ShowLabel(A, true)`。
     3. **显名+坐标**: `SetLabelMode(A, 1)`。
   - 题意里有动点的，一定要用slider去控制动点
   - 不要出现“SetVisibleInView(xAxis, 1, false)”和“SetVisibleInView(yAxis, 1, false)”
   - 交点处理：若直线与圆锥曲线有两个交点，可采用以下任一方式筛选所需交点：
        索引直接选取：
        # 先获取两个交点（顺序不确定）
        tempA = Intersect(l, C, 1)
        tempB = Intersect(l, C, 2)

        # 再根据y坐标大小分配A和B
        A = If(y(tempA) > y(tempB), tempA, tempB)  # y坐标大的为A
        B = If(y(tempA) < y(tempB), tempA, tempB)  # y坐标小的为B
        再将tempA和tempB设为不可见：SetVisibleInView(tempA, 1, false), SetVisibleInView(tempB, 1, false)
     // 不要用 Element 来选择交点，因为它会导致错误的交点被选择。要用 Intersect 函数来选择交点。
    - 不要出现文字说明，例如“焦点在(2,0)”，“准线与x轴交点为(2,0)”等。
    - 斜率参数化：若斜率随参数变化，禁用 Slope 函数获取；应先用 Slider 定义主控参数（如 m），再用方向向量显式构造直线，例如  
      m = Slider(-5, 5, 0.1)  
      lineAP = Line(A, A + (1, m))  
      lineAQ = Line(A, A + (1, -m))  
      对称直线亦用同一参数构造，确保联动一致。
    - 题目里出现的所有点、线都要定义, 而且都要setVisibleInView(true)
    - 垂直平分线使用专用命令 PerpendicularBisector + ShowLabel(true) + SetVisibleInView(true)，例如：
      lineBP = PerpendicularBisector(A, B), ShowLabel(l_prime, true), SetVisibleInView(l_prime, 1, true)
      不要用Midpoint + PerpendicularLine来构造垂直平分线
    - 水平线 / 竖直线用两点法构建，例如 `Line(A, B)`、`Line(A, A + (1, m))`；不要用“点+斜率”形式，例如 `l: y = k(x - 1)`，因为它会导致错误的直线被绘制。
2. **坐标系与视图**:
   - 默认显示坐标轴和网格: `SetAxesVisible(true, true)`，不要隐藏坐标轴。
3. **焦点计算与标记**:
   - **必须手动计算**: 根据标准方程求出a,b,c，并显式定义焦点坐标点。
   - 例: 双曲线 `x^2/4 - y^2 = 1` -> a=2, b=1 -> c=sqrt(5) -> 定义 `F1=(-2.23, 0)`, `F2=(2.23, 0)`；
        椭圆 `x^2/9 + y^2/4 = 1` -> a=3, b=2 -> c=sqrt(5) -> 定义 `F1=(-2.23, 0)`, `F2=(2.23, 0)`；
        抛物线 'y^2=8x' -> p=2 -> 定义 F=(2,0), d: x=-2
   - **圆锥曲线样式统一**: `SetColor(F1, \"Black\")`, `SetPointSize(F1, 4)`, `SetLabelMode(F1, 1)`, 'SetVisibleInView(F1, 1, true)' (F2 或 F 同理)。
4. **圆锥曲线构建**:
   - **必须使用参数定义法构建圆锥曲线，禁止仅用隐式方程直接绘制**。
   - 椭圆：用 Ellipse(F1,F2,半长轴a) 构建，例如 Ellipse(F1,F2,2)，其中a=2为半长轴
   - 双曲线：用 Hyperbola(F1, F2, 长半轴) 构建，例如 Hyperbola(F1,F2,2)。
   - 抛物线：用 Parabola(F,d)（焦点+准线）构建。例如，F=(2,0)，d: x=-2，P=Parabola(F,d)
   - 隐函数方程：用冒号（注意不要用等号）定义隐式曲线的方式构建，例如：C: sqrt((x + 1)^2 + y^2)^3 + sqrt((x - 1)^2 + y^2)^3 = k
   - 其他：用代数方程直接构建，例如 `y^2=4x`，不要用“几何轨迹法”来构建（例如：试图通过“到两定点距离之和为定值”来定义椭圆（或圆））。
   - **样式统一**: 统一用黑色 `SetColor(C, "Black")`。
5. **分析动点并构建动点 (Point Motion)**:
   - 第一步：深度理解题意，题意中出现的动点，后续都要构建。
   - **Case A: 闭合曲线 (椭圆/圆)**
     - **局部限制 (Arc Method)**: 明确理解题意，确定动点的运动范围。比如：若限制在第一象限，先定义端点 `A, B`，再 `arc = Arc(c1, A, B)`，t = Slider(0.01, 0.99, 0.01)，最后 `P = Point(arc, t)`。
   - **Case B: 双曲线/抛物线**
     - 默认使用 `t = Slider(0, 1, 0.01)` -> `P = Point(c1, t)`.
   - **动点样式统一**: 统一用红色和蓝色
   - 每个动点定义后，**必须**执行两步操作(动点一定不要SetFixed)：
    1. **显标签**: `ShowLabel(P, true)`。
    2. **显名+坐标**: `SetLabelMode(P, 1)`。
   - **slider参数设计原则**：
     - **完整性**：参数范围必须能覆盖所有可能的几何情况。
     - **对称性**：若图形或代数结构具有对称性，参数范围应设计成对称形式，如 [−a,a]。
     - **可观察性**：范围不能过小，应至少能展示交点产生、临界变化、渐近趋势等过程。
     - **连续性**：步长适中，保证动画平滑，便于观察轨迹。
     - **Slider 指令格式**：所有 Slider 指令统一使用简化格式：
       t = Slider(最小值, 最大值, 步长)。禁止出现带 5 个参数的完整格式，如 t = Slider(0.01, 0.99, 0.01, 1, true) 
6. **辅助线、填充**:
   - 焦点三角形、准线、渐近线等：
     - **焦点三角形**：若需填充三角形区域，使用 `Polygon(F1, F2, P)` 构建后，设置 `SetFilling(triangle, 0.3)` 与 `SetColor(triangle, "LightBlue")`（透明度 0.3，颜色可自定）。
     - **准线**：用 `Line` 或 `Segment` 绘制后，设置虚线样式 `SetLineStyle(directrix, 2)` 并着色 `SetColor(directrix, "Gray")`。
     - **渐近线**：双曲线渐近线用 `Line` 绘制，设置 `SetLineStyle(asymptote, 3)`（点划线）与 `SetColor(asymptote, "DarkGray")`。
     - **区域填充**：若题目要求填充椭圆/双曲线与直线围成的区域，先用 `Intersect` 求交点，再用 `Polygon` 构建封闭区域，最后 `SetFilling(region, 0.2)` 并设置浅色填充。

### 严格语法约束
- 对象: Point, Slider, Circle, Ellipse, Hyperbola, Parabola, Segment, Line, Intersect, Arc.
- 属性: SetColor, SetLineStyle, SetFixed, SetLabelMode, ShowLabel, SetVisibleInView.
- 禁用: ImplicitCurve
"""

PROMPT_SOLID = """
你是一位立体几何专家。请生成 GeoGebra 指令来构建 3D 空间几何体。
**输出第一行必须是**: `MODE: 3D`
 "在开始构建前，先执行以下判断逻辑：\\n"
    "1. **图文协同模式 (Scenario: With Diagram)**: \\n"
    "   - 当图片包含几何配图时，执行 **“拓扑看图，参数看文”**。\\n"
    "   - 看图 (Topology): 决定静态定点的相对位置与形状结构（如定点P在第一卦限，图示是球体则画球体）；注意：动点的运动范围与轨迹逻辑必须严格遵循文字描述。\\n"
    "   - 看文 (Parameters): 决定具体数值。例如: 解析文字中的边长 `AB=2` 或高 `h=3`，不要试图通过测量图片像素来猜测数值。\\n"
    "2. **纯文重建模式 (Scenario: Text Only)**\\n"
    "   - 当图片仅含文字描述（无几何配图）时，执行 **“标准构建”**。\\n"

### 构建策略
1. **原则**:
   - 每个静态点定义后，**必须**执行三步操作：
     1. **锁定**: `SetFixed(A, true)`。
     2. **显标签**: `ShowLabel(A, true)`。
     3. **显名+坐标**: `SetLabelMode(A, 1)`。
   - 不要出现“SetVisibleInView(xAxis, 1, false)”和“SetVisibleInView(yAxis, 1, false)”和“SetVisibleInView(zAxis, 1, false)”
   - 不要出现多余文字
   - 辅助平面/无限直线必须隐藏: `SetVisibleInView(obj, -1, false)`.
   - 题目有图片的，注意要和图片中方向一致，不要镜像构建。
   - 题目描述有球体就要构建球体，有圆锥就要构建圆锥，有圆柱就要构建圆柱，有平面就要构建平面（用Polygon）。
   - 中点构建，不要用Midpoint(A,B)；要先把中点的具体具体坐标算出来，然后再用Point(坐标)构建。
2. **原子化构建 (Atomic Construction)**:
   - **智能建系**: 根据几何体特征自动选择最简坐标原点与轴向，建立符合右手定则的空间直角坐标系，
   - **手动连棱**: **严禁**使用 `Cube` 或 `Prism` 封装命令。必须算出所有顶点坐标，然后用 `Segment(A, B)` 逐一连线（每行仅输出一条棱，禁止多棱合并），且每条棱需单独设置属性。例如：
     ```
     s1 = Segment(A, B)
     s2 = Segment(B, C)
     s3 = Segment(C, D)
     ```
   - **棱样式统一**: 不要setlinestyle，默认用实线，颜色统一用黑色。
   - **顶点锁定**: `SetFixed(P, true)`, `ShowLabel(P, true)`, `SetLabelMode(P, 1)`, `SetColor(P, "Blue")`.
3. **旋转体 (球/圆锥/圆柱)**:
   - 先观察题目描述的旋转体类型，再分情况生成
     若为球体：要用 Sphere(中心, 半径) 或 Sphere(中心, 点) 构建，禁止出现 SetVisibleInView(球, 1, false)
     若为圆锥：要用 Cone(中心, 半径, 高) 或 Cone(中心, 点, 高) 构建，禁止出现 SetVisibleInView(圆锥, 1, false)
     若为圆柱：要用 Cylinder(中心, 半径, 高) 或 Cylinder(中心, 点, 高) 构建，禁止出现 SetVisibleInView(圆柱, 1, false)
   - 底面: `base = Circle(O, R, xOyPlane)`.
   - 如果球体和xoy平面相交，必须用Intersect(球体, 平面)求交线，交线设为虚线，颜色为黑色。
4. **动点逻辑**:
   - 所有动点统一用 Point 指令构建，例如：`P = Point(path)`。
   - 严禁出现 Slider；动点必须通过 Point 直接依附于已有路径或区域。
   - **线段上**: `P = Point(Segment(A,B))`，路径用虚线表示，例如：直线路径可以是l: Segment((1,1), (5,5)), SetLineStyle(l, 2)`；
   - **圆周上**： 圆周路径用虚线表示 c: Circle((0,0), 3), SetLineStyle(c, 2)。
   - **面上**: `P = PointIn(polyFace)`。
   - **动点样式统一**: 统一用红色
   - 每个动点定义后，**必须**执行两步操作(动点一定不要SetFixed)：
    1. **显标签**: `ShowLabel(P, true)`。
    2. **显名+坐标**: `SetLabelMode(P, 1)`。
5. **辅助线、填充**:
   - **辅助平面/无限直线**：仅用于空间定位，构建后务必隐藏：`SetVisibleInView(obj, -1, false)`。
   - **截面/交线**：
     - 平面与几何体相交，先用 `Intersect` 求交线，再 `SetLineStyle(section, 2)` 设为虚线，`SetColor(section, "Gray")`。
   - **动点路径**：
     - 若动点依附于某条空间折线或圆，需先用 `Segment`/`Circle` 画出路径，设置 `SetLineStyle(path, 2)` 并设为红色   
   - **区域填充**：
     - 需要表现“截面”“阴影区域”时，用 `Polygon` 构建封闭多边形后，`SetFilling(poly, 0.25)` 设置 25 % 透明度，颜色取浅色；若仅需描边，则 `SetLineStyle(poly, 2)` 并 `SetColor(poly, "Gray")`。
   - **文字与标签**：
     - 严禁出现任何文字说明；所有信息仅通过点、线、面、颜色与透明度表达。

### 严格语法约束
- 对象: Point, Segment, Polygon, Circle, Arc, Sphere, Cone, Cylinder, Intersect, PointIn.
- 属性: SetColor, SetFilling, SetLineStyle, SetFixed, SetLabelMode, ShowLabel, SetVisibleInView.
"""

PROMPT_MAP = {
    'A': PROMPT_FUNCTION,
    'B': PROMPT_GEOMETRY,
    'C': PROMPT_ANALYTIC,
    'D': PROMPT_SOLID
}

# --- Model Factory & Adapters ---

class ModelAdapter:
    def generate(self, prompt, image_bytes=None, mime_type=None):
        raise NotImplementedError

class GeminiAdapter(ModelAdapter):
    def __init__(self, api_key=None, model_name='gemini-3-flash-preview'):
        if api_key:
            genai.configure(api_key=api_key)
        # Use provided model name or default
        self.model = genai.GenerativeModel(model_name)

    def generate(self, prompt, image_bytes=None, mime_type=None):
        content = []
        if image_bytes:
            content.append({'mime_type': mime_type, 'data': image_bytes})
        content.append(prompt)
        
        response = self.model.generate_content(content)
        if not response.parts:
            return ""
        return response.text.strip()

class OpenAICompatibleAdapter(ModelAdapter):
    def __init__(self, api_key, base_url, model_name):
        self.client = openai.OpenAI(api_key=api_key, base_url=base_url)
        self.model_name = model_name

    def generate(self, prompt, image_bytes=None, mime_type=None):
        # Image to Base64 if exists
        base64_image = None
        if image_bytes:
            base64_image = base64.b64encode(image_bytes).decode('utf-8')
        
        try:
            # 区分 "System" (指令) 和 "User" (数据)
            user_content = []
            if base64_image:
                user_content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime_type};base64,{base64_image}"
                    }
                })
                user_content.append({"type": "text", "text": "请根据图片内容执行任务。"})
            else:
                user_content.append({"type": "text", "text": "请根据以上文字描述执行任务。"})

            messages = [
                {
                    "role": "system",
                    "content": prompt  # 专家指令作为 System Prompt
                },
                {
                    "role": "user",
                    "content": user_content
                }
            ]

            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
            )
            
            # 检查停止原因
            finish_reason = response.choices[0].finish_reason
            if finish_reason == 'content_filter':
                print("WARNING: Response truncated by content filter")
            elif finish_reason == 'length':
                print("WARNING: Response truncated by length limit")

            content = response.choices[0].message.content
            refusal = getattr(response.choices[0].message, 'refusal', None)

            # 优先返回 refusal 信息
            if refusal:
                print(f"DEBUG: Model Refusal: {refusal}")
                return f"Error: Model Refused - {refusal}"
            
            return content if content else ""

        except Exception as e:
            print(f"OpenAI Adapter Error: {e}")
            raise e

class ModelFactory:
    @staticmethod
    def create(user_profile=None):
        # 1. Check for custom configuration (BYOK)
        if user_profile and user_profile.get('use_custom_model'):
            print("DEBUG: Using custom model config")
            api_key = user_profile.get('custom_api_key')
            base_url = user_profile.get('custom_base_url')
            model_name = user_profile.get('custom_model_name')
            
            if not api_key:
                 raise ValueError("Custom API Key is missing")
            
            # Special handling for Doubao (Volcengine) compatibility
            # Users might provide base_url without /api/v3, try to handle or assume user provides correct one.
            # But standard OpenAI SDK usually works if base_url is correct.
            
            return OpenAICompatibleAdapter(api_key, base_url, model_name)
        
        # 2. Default System Model (Gemini)
        print("DEBUG: Using system default model (Gemini)")
        return GeminiAdapter(api_key=GOOGLE_API_KEY)

# --- Routes ---

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal Server Error', 'details': str(error)}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e,  Exception):
        return jsonify({'error': str(e)}), 500
    return jsonify({'error': 'Unknown error'}), 500

@app.route('/api/', methods=['GET'])
def index():
    return "MathMover Backend is running."

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """
    接收前端上传的图片文件或文本，并根据用户输入（可选）进行处理
    """
    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] === 收到新生成请求 ===")
    
    image_data = None
    mime_type = None
    
    # 1. 优先检查是否有文件上传
    if 'file' in request.files:
        file = request.files['file']
        if file.filename != '':
            # 限制文件大小为 5MB (5 * 1024 * 1024 bytes)
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            if file_size > 5 * 1024 * 1024:
                return jsonify({'error': '上传的图片不能超过 5MB'}), 400
                
            image_data = file.read()
            mime_type = file.mimetype
            print(f"DEBUG: 从文件上传中读取图片, size: {len(image_data)} bytes, type: {mime_type}")

    # 2. 如果没有文件，检查是否有 imageUrl
    if not image_data:
        image_url = request.form.get('imageUrl')
        if image_url:
            print(f"DEBUG: 未检测到文件，尝试从 URL 下载: {image_url}")
            try:
                resp = requests.get(image_url, timeout=(3, 5))
                resp.raise_for_status()
                image_data = resp.content
                mime_type = resp.headers.get('Content-Type', 'image/jpeg') # 默认 jpeg
                print(f"DEBUG: 图片下载成功, size: {len(image_data)} bytes, type: {mime_type}")
            except Exception as e:
                print(f"ERROR: 图片下载失败: {e}")
                return jsonify({'error': f'Failed to download image from URL: {str(e)}'}), 400

    # 3. 如果两者都没有，且也没有 text_prompt，报错
    text_prompt = request.form.get('text', '')
    if not image_data and not text_prompt.strip():
        return jsonify({'error': '请先上传图片、提供图片URL或输入题目文字内容'}), 400
    
    # 修复漏洞 1：从 Authorization Header 获取 Token 并验证，不再信任前端传来的 user_id
    auth_header = request.headers.get('Authorization')
    user_id = None
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.split(' ')[1]
        try:
            user_resp = supabase.auth.get_user(token)
            if user_resp and user_resp.user:
                user_id = user_resp.user.id
        except Exception as e:
            print(f"Auth Error: {e}")
            return jsonify({'error': '无效的身份验证凭证'}), 401

    if not user_id:
        return jsonify({'error': '未授权的请求，请先登录'}), 401

    print(f"DEBUG: 收到请求，已验证 user_id 为 {user_id}")

    # Determine model configuration and credit deduction
    deduct_credits = True
    user_profile = None

    if user_id and supabase:
        try:
            print(f"DEBUG: 正在查询用户 {user_id} 的 profile...")
            # 使用 Service Role Key 查询，必须调用 .execute()
            response = supabase.table('profiles').select('*').eq('id', user_id).single().execute()
            
            user_profile = response.data
            if user_profile:
                 is_byok = user_profile.get('use_custom_model', False)
                 
                 if is_byok:
                    # BYOK 权限校验
                    sub_type = user_profile.get('subscription_type', 'free')
                    expires_at_str = user_profile.get('subscription_expires_at')
                    
                    is_valid_sub = False
                    if sub_type in ['basic', 'pro'] and expires_at_str:
                        try:
                            # 处理可能的时区格式
                            if expires_at_str.endswith('Z'):
                                expires_at_str = expires_at_str[:-1] + '+00:00'
                            expires_at = datetime.fromisoformat(expires_at_str)
                            if expires_at > datetime.now(expires_at.tzinfo):
                                is_valid_sub = True
                        except ValueError:
                            print(f"Error parsing date: {expires_at_str}")

                    if is_valid_sub:
                        deduct_credits = False
                        print(f"DEBUG: BYOK mode enabled. User is valid {sub_type} subscriber.")
                    else:
                        return jsonify({'error': 'BYOK 模式仅限基础版/专业版会员使用，请前往升级'}), 403
                 
                 # 如果需要扣费，直接调用数据库原子扣费函数
                 if deduct_credits:
                     try:
                         # 调用原子扣费函数，如果余额不足，数据库会抛出异常
                         supabase.rpc('decrement_credits_atomic', {'user_uuid': user_id}).execute()
                         print(f"DEBUG: 已在后端成功扣除用户 {user_id} 的积分")
                     except Exception as e:
                         error_msg = str(e)
                         print(f"Error deducting credits: {error_msg}")
                         if 'Insufficient credits' in error_msg:
                             return jsonify({'error': '积分不足，请充值'}), 403
                         return jsonify({'error': '扣费失败，请稍后重试'}), 500

            else:
                 print(f"DEBUG: 未找到用户 {user_id} 的 profile 数据")
                 return jsonify({'error': '用户数据未找到'}), 404
                 
        except Exception as e:
            print(f"Warning: Failed to fetch user profile: {e}")
            import traceback
            traceback.print_exc()

    try:
        model_adapter = ModelFactory.create(user_profile)
    except Exception as e:
        return jsonify({'error': f'Model configuration error: {str(e)}'}), 500

    def generate():
        try:
            # --- Step 1: Router ---
            print("DEBUG: Calling Router...")
            try:
                # 如果没有图片，修改 router prompt 描述
                router_prompt_to_use = ROUTER_PROMPT
                if not image_data:
                    router_prompt_to_use = router_prompt_to_use.replace("根据图片内容", "根据题目文字内容")
                
                # 确保将用户输入的文本也发给分类器
                final_router_prompt = router_prompt_to_use
                if text_prompt:
                    final_router_prompt = f"待分类的题目内容/补充说明如下：\n{text_prompt}\n\n" + router_prompt_to_use
                
                router_result_text = model_adapter.generate(final_router_prompt, image_data, mime_type)
                print(f"\n--- [DEBUG: RAW ROUTER OUTPUT] ---\n{router_result_text}\n------------------------------")
            except Exception as router_e:
                print(f"ERROR: Router failed: {router_e}")
                yield json.dumps({'status': 'error', 'message': f'分类模型调用失败: {str(router_e)}'}) + '\n'
                return

            if not router_result_text:
                 yield json.dumps({'status': 'error', 'message': 'Router returned no content.'}) + '\n'
                 return

            # Parse JSON Router Result
            category = 'A' # Default
            reason = ''
            
            try:
                # 尝试清理可能存在的 markdown 标记
                clean_json = router_result_text.strip()
                if clean_json.startswith('```json'):
                    clean_json = clean_json[7:]
                if clean_json.startswith('```'):
                    clean_json = clean_json[3:]
                if clean_json.endswith('```'):
                    clean_json = clean_json[:-3]
                
                router_data = json.loads(clean_json.strip())
                category = router_data.get('category', 'A').upper()
                reason = router_data.get('reason', '')
                
                # Double check category validity
                if category not in ['A', 'B', 'C', 'D']:
                    category = 'A'
                    
            except json.JSONDecodeError:
                print("DEBUG: JSON decode failed, falling back to regex")
                # Fallback to regex if JSON fails
                import re
                match = re.search(r'"category":\s*"([ABCD])"', router_result_text)
                if not match:
                    match = re.search(r'([ABCD])', router_result_text)
                category = match.group(1) if match else 'A'

            if category not in PROMPT_MAP:
                category = 'B' # Default to Geometry
                
            print(f"DEBUG: Classified as: {category}, Reason: {reason}")
            
            # Send classification status with reason
            yield json.dumps({'status': 'classified', 'category': category, 'reason': reason}) + '\n'
            
            # --- Step 2: Specialist ---
            selected_prompt = PROMPT_MAP[category]
            if text_prompt:
                selected_prompt = f"用户补充说明：{text_prompt}\n\n" + selected_prompt
            
            print(f"DEBUG: Calling Specialist {category}...")
            try:
                specialist_result_text = model_adapter.generate(selected_prompt, image_data, mime_type)
                print(f"\n--- [DEBUG: RAW SPECIALIST OUTPUT] ---\n{specialist_result_text}\n------------------------------")
            except Exception as specialist_e:
                 print(f"ERROR: Specialist failed: {specialist_e}")
                 yield json.dumps({'status': 'error', 'message': f'专家模型调用失败: {str(specialist_e)}'}) + '\n'
                 return

            # 防御性检查：确保模型返回了内容
            if not specialist_result_text or specialist_result_text.strip() == "":
                 print(f"DEBUG: 模型返回为空！可能是触发了安全过滤或网络问题。")
                 yield json.dumps({"status": "error", "message": "模型未能生成指令，请尝试更换题目图片或模型。"}).encode() + b'\n'
                 return

            print(f"DEBUG: Generated text length: {len(specialist_result_text)}")
            
            commands = [line.strip() for line in specialist_result_text.split('\n') if line.strip()]
            
            # Send completion with credit deduction flag
            yield json.dumps({
                'status': 'completed', 
                'commands': commands, 
                'category': category,
                'deduct_credits': deduct_credits
            }) + '\n'

        except Exception as e:
            print(f"CRITICAL ERROR: {str(e)}")
            import traceback
            traceback.print_exc()
            # 确保将错误返回给前端
            yield json.dumps({'status': 'error', 'message': f'系统内部错误: {str(e)}'}) + '\n'

    return Response(stream_with_context(generate()), mimetype='application/x-ndjson', headers={'X-Accel-Buffering': 'no'})

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)
