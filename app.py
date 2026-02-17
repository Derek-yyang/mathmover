import os
import json
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import google.generativeai as genai
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 配置代理 (在初始化 Gemini 之前执行)
# 使用 http://127.0.0.1:11719 作为代理地址
os.environ['HTTP_PROXY'] = 'http://127.0.0.1:11719'
os.environ['HTTPS_PROXY'] = 'http://127.0.0.1:11719'

from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # 启用 CORS，允许所有来源访问

# 配置 Google Gemini API
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
if not GOOGLE_API_KEY:
    print("Warning: GOOGLE_API_KEY not found in environment variables.")

genai.configure(api_key=GOOGLE_API_KEY)

# 初始化模型
model = genai.GenerativeModel('gemini-3-flash-preview')

# --- 1. 路由分发器 (Router) ---
ROUTER_PROMPT = """
你是一个数学题目分类器。请根据图片内容，判断题目属于以下哪一类，并仅返回对应的字母类别代码（A/B/C/D）。

分类标准：
A：函数与图像（一次、二次、三角、导数、一般函数）
B：平面几何（圆、多边形、角平分线、平面向量）
C：解析几何（椭圆、双曲线、抛物线、圆锥曲线）
D：立体几何（正方体、四面体、空间动点、球、旋转体）

要求：
- 仅返回一个字母：A、B、C 或 D。
- 不要包含任何解释或其他文字。
"""

# --- 2. 专家 Prompt 库 ---

# 专家 A: 函数专家
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
   - 样式: `SetColor(P, "Black")`, `SetPointSize(P, 4)`, `SetLabelMode(P, 1)`。
5. **动点与交互**:
81→   - 若有点 P 在函数上运动，使用 `t = Slider(xMin, xMax, 0.1)` -> `P = (t, f(t))`。
82→   - 样式: `SetColor(P, "Red")`, `ShowLabel(P, true)`, `SetLabelMode(P, 1)`。
6. **辅助构造**:
   - 若有辅助线（如垂线、平分线），使用 `Line(A, B)` 或 `Segment(A, B)`。
   - 样式: `SetLineStyle(L, "Dashed")`, `SetColor(L, "Gray")`。
   - 若题目描述里出现“封闭图形”“面积”“阴影”“区域”等关键词，务必用 Polygon 构建封闭区域后，执行 `SetFilling(poly, 0.2)`（或根据题意自选浅色），透明度可设为 0.2–0.4；若仅需描边，则改用 `SetLineStyle(poly, "Dashed")` 并 `SetColor(poly, "Gray")`。

### 严格语法约束
- 对象: Point, Slider, Function, Intersect, Segment, Line, Polygon.
- 属性: SetColor, SetLineStyle, SetFixed, SetLabelMode, ShowLabel.
"""

# 专家 B: 平面几何专家
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
125→     - 定义滑块: `t = Slider(0, 1, 0.01)` (0代表边起点，1代表边终点)。
126→     - 绑定动点: `M = Point(Segment(A,B), t)`。
   - **slider参数设计原则**：
     - **可观察性**：范围不能过小，应至少能展示交点产生、临界变化、渐近趋势等过程。
     - **连续性**：步长适中，保证动画平滑，便于观察轨迹。
6. **辅助构造**:
   - 垂线、中线、角平分线：使用 `Segment`, `Midpoint`, `AngleBisector` 等指令。
   - 动点的路径，可以用虚线表示，例如：直线路径可以是l: Segment((1,1), (5,5)), SetLineStyle(l, 2)`；圆路径可以是 c: Circle((0,0), 3), SetLineStyle(c, 2)。

### 严格语法约束
- 对象: Point, Slider, Polygon, Circle, Segment, Line, Angle, AngleBisector, Midpoint, Intersect.
- 属性: SetColor, SetFilling, SetLineStyle, SetFixed, SetLabelMode, ShowLabel.
"""

# 专家 C: 解析几何专家 (圆锥曲线)
PROMPT_ANALYTIC = """
你是一位解析几何专家。请生成 GeoGebra 指令来精确绘制圆锥曲线。
**输出第一行必须是**: `MODE: 2D`
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
   - 不要出现“SetVisibleInView(xAxis, 1, false)”和“SetVisibleInView(yAxis, 1, false)”
   - 交点处理：若直线与圆锥曲线有两个交点，使用列表接收后通过距离判断筛选所需交点，示例：
     ptsC = {Intersect(linePA, e1)}  // 获取所有交点，放入列表
     C = If(Distance(Element(ptsC, 1), A) > 0.1, 
            Element(ptsC, 1), 
            Element(ptsC, 2))
     // 不要用 Element 来选择交点，因为它会导致错误的交点被选择。要用 Intersect 函数来选择交点。
    - 不要出现文字说明，例如“焦点在(2,0)”，“准线与x轴交点为(2,0)”等。
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
6. **辅助线、填充**:
   - 水平线 / 竖直线优先用两点法构建，例如 `Line(A, B)`；不要用“点+斜率”形式，因为它会导致错误的直线被绘制。
   - 焦点三角形、准线、渐近线等：
     - **焦点三角形**：若需填充三角形区域，使用 `Polygon(F1, F2, P)` 构建后，设置 `SetFilling(triangle, 0.3)` 与 `SetColor(triangle, "LightBlue")`（透明度 0.3，颜色可自定）。
     - **准线**：用 `Line` 或 `Segment` 绘制后，设置虚线样式 `SetLineStyle(directrix, 2)` 并着色 `SetColor(directrix, "Gray")`。
     - **渐近线**：双曲线渐近线用 `Line` 绘制，设置 `SetLineStyle(asymptote, 3)`（点划线）与 `SetColor(asymptote, "DarkGray")`。
     - **区域填充**：若题目要求填充椭圆/双曲线与直线围成的区域，先用 `Intersect` 求交点，再用 `Polygon` 构建封闭区域，最后 `SetFilling(region, 0.2)` 并设置浅色填充。

### 严格语法约束
- 对象: Point, Slider, Circle, Ellipse, Hyperbola, Parabola, Segment, Line, Intersect, Arc.
- 属性: SetColor, SetLineStyle, SetFixed, SetLabelMode, ShowLabel, SetVisibleInView.
"""

# 专家 D: 立体几何专家
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
   - 不要出现Slider函数：t = Slider(0, 1, 0.01)
   - 不要出现“SetVisibleInView(xAxis, 1, false)”和“SetVisibleInView(yAxis, 1, false)”和“SetVisibleInView(zAxis, 1, false)”
   - 不要出现多余文字
   - 辅助平面/无限直线必须隐藏: `SetVisibleInView(obj, -1, false)`.
   - 题目有图片的，注意要和图片中方向一致，不要镜像构建。
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
   - 球面生成：优先用Sphere(中心, 半径)​ 、Sphere(中心, 点)​ 这两种方法构建球体。
   - 底面: `base = Circle(O, R, xOyPlane)`.
   - 侧面: 使用 `Cone`, `Cylinder`, `Sphere`。
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

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal Server Error', 'details': str(error)}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    # pass through HTTP errors
    if isinstance(e,  Exception):
        return jsonify({'error': str(e)}), 500
    return jsonify({'error': 'Unknown error'}), 500


# 配置安全设置，允许所有内容 (防止数学题目被误判)
safety_settings = [
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
]

@app.route('/', methods=['GET'])
def index():
    return "MathMover Backend is running."

@app.route('/upload', methods=['POST'])
def upload_file():
    # 检查 API Key 是否存在
    if not GOOGLE_API_KEY:
        print("CRITICAL ERROR: GOOGLE_API_KEY is missing!")
        return jsonify({'error': 'Server configuration error: API Key missing'}), 500

    if 'image' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    # 获取可选的文本输入
    text_prompt = request.form.get('text', '')

    # 读取图片数据
    image_data = file.read()
    mime_type = file.mimetype
    print(f"DEBUG: Image read, size: {len(image_data)} bytes, type: {mime_type}")

    def generate():
        try:
            # --- 第一步：路由分发 (Router) ---
            print("DEBUG: Calling Router...")
            router_response = model.generate_content([
                {'mime_type': mime_type, 'data': image_data},
                ROUTER_PROMPT
            ])
            
            if not router_response.parts:
                 print("DEBUG: Router returned no content.")
                 yield json.dumps({'error': 'Router failed to classify image.'}) + '\n'
                 return

            router_result = router_response.text.strip().upper()
            # 提取第一个字母 (以防模型输出多余标点)
            category = router_result[0] if router_result else 'A' 
            # 默认回退到 A，或进行校验
            if category not in PROMPT_MAP:
                print(f"DEBUG: Unknown category '{router_result}', defaulting to B (Geometry)")
                category = 'B'
                
            print(f"DEBUG: Router classified as: {category}")
            
            # 立即发送分类结果给前端
            yield json.dumps({'status': 'classified', 'category': category}) + '\n'
            
            # --- 第二步：专家生成 (Specialist) ---
            selected_prompt = PROMPT_MAP[category]
            
            # 如果用户提供了文本输入，拼接到 Prompt 前面
            if text_prompt:
                selected_prompt = f"用户补充说明：{text_prompt}\n\n" + selected_prompt
            
            print(f"DEBUG: Calling Specialist {category}...")
            
            specialist_response = model.generate_content([
                {'mime_type': mime_type, 'data': image_data},
                selected_prompt
            ])
            
            if not specialist_response.parts:
                 print("DEBUG: Specialist returned no content.")
                 yield json.dumps({'error': 'Specialist generation failed.'}) + '\n'
                 return

            generated_text = specialist_response.text.strip()
            print(f"DEBUG: Generated text length: {len(generated_text)}")
            
            # 处理返回的指令 (按行分割)
            commands = [line.strip() for line in generated_text.split('\n') if line.strip()]
            
            # 发送最终指令
            yield json.dumps({'status': 'completed', 'commands': commands, 'category': category}) + '\n'

        except Exception as e:
            print(f"ERROR: {str(e)}")
            yield json.dumps({'error': str(e)}) + '\n'

    return Response(stream_with_context(generate()), mimetype='application/x-ndjson', headers={'X-Accel-Buffering': 'no'})

if __name__ == '__main__':
    # host='0.0.0.0' 允许外部访问 (Docker 部署必需)
    app.run(debug=True, host='0.0.0.0', port=5000)
