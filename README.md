# pptx-generator · 程序化演示文稿生成

> 一句话简介：用 `pptxgenjs` 以代码生成演示文稿——虚拟节点树自动算坐标 + matplotlib 算法可视化配图。

配套的 Word 版本：[docx-generator](https://github.com/YGtemple/docx-generator)

## 一、核心机制：虚拟节点树

用 `pptxgenjs` 排版最烦的是**坐标要手算**。想在一个卡片里放标题和正文，得先知道卡片的绝对位置，再算标题相对页面的坐标——卡片一挪，里面所有元素都得跟着改。

这套工具用**虚拟节点树 + 一次性扁平化**解决：

```js
function createVirtualNode(type, data, parentX = 0, parentY = 0) {
  const opts = data.opts || {};
  const node = {
    type, data,
    absX: parentX + (opts.x || 0),   // 累加父级坐标
    absY: parentY + (opts.y || 0),
    w: opts.w || 0, h: opts.h || 0,
    children: []
  };

  node.addShape = function(shapeType, opts = {}) {
    const child = createVirtualNode('shape', { shapeType, opts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };
  // addText / addImage / addTable 同理
  return node;
}
```

关键在 `absX: parentX + (opts.x || 0)`——**每层的相对坐标在创建时就累加成绝对坐标**。嵌套三层也不会算错。

写完结构后一次性展开：

```js
function flattenNode(node, realSlide, pres) {
  const absOpts = { ...node.data.opts, x: node.absX, y: node.absY };
  if (node.type === 'shape') realSlide.addShape(node.data.shapeType, absOpts);
  else if (node.type === 'text')  realSlide.addText(node.data.text, absOpts);
  else if (node.type === 'image') realSlide.addImage(absOpts);
  else if (node.type === 'table') realSlide.addTable(node.data.tableData, absOpts);
  node.children.forEach(child => flattenNode(child, realSlide, pres));   // 递归
}
```

`addSlide` 也被 hook 了一层：返回虚拟 slide 而非真实 slide，等 `flattenNode` 时才真正写入。这样「布局」和「输出」两个阶段完全分开——布局阶段随便试错，不影响已生成的 pptx。

## 二、两个细节

### 自动剔除手写的项目符号

```js
const bulletRe = /^(?:[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25CB\u2013\u2014]\s*|\-\s+)/;
```

`pptxgenjs` 的 `bullet: true` 会自己画项目符号。如果文本里已经手写了 `•`，渲染出来就是「• • 内容」两个点。

这个正则覆盖 9 种常见项目符号字符（实心圆点 •、三角 ‣、空心圆 ◦、连字符变体 ⁃、圆点运算符 ∙、间隔号 ·、实心大圆 ●、空心大圆 ○、短破折号 –、长破折号 —）以及 `- ` 写法，在传给 `addText` 前统一剥掉。

### 文本框默认 shrink

```js
node.addText = function(text, opts = {}) {
  const safeOpts = { fit: "shrink", ...opts };
  ...
}
```

`fit: "shrink"` 让文字在超出文本框时自动缩小而不是溢出。作为**默认值**（注意展开顺序：`...opts` 在后，调用方仍可覆盖），能避免大部分「中文比英文宽、结果溢出卡片」的情况。

## 三、配色系统

每份 PPT 一套独立的配色令牌，按主题命名：

```js
// Ocean Gradient（海洋渐变）—— 算法题解用
const C = {
  primary:   '065A82',
  secondary: '1C7293',
  accent:    '21295C',
  bg:        'F0F7FA',
  // 代码块专用配色（深底 + VSCode 风格语法色）
  codeBg:      '1E2A3A',
  codeText:    'E0E0E0',
  codeKeyword: '569CD6',
  codeString:  'CE9178',
  codeComment: '6A9955',
  codeNumber:  'B5CEA8',
};
```

代码块配色是单独一组：深色底 `1E2A3A` 配 VSCode Dark+ 的语法高亮色（关键字蓝、字符串橙、注释绿、数字浅绿）。这样 PPT 里贴代码段时的观感与编辑器一致。

```js
// Teal Horizon（青绿地平线）—— 项目路演用
const C = {
  navy: '0A2540', deepBlue: '0A4D68', teal: '088395',
  brightTeal: '05BFDB', coral: 'FF6B6B', gold: 'FFD93D',
  ...
};
```

中英文字体分三档：

```js
const FONT_T = "Georgia";           // 标题（衬线，正式感）
const FONT_B = "Calibri";           // 正文
const FONT_CJK = "Microsoft YaHei"; // 中文
```

## 四、算法可视化配图

PPT 里的算法示意图不是截图，而是 `matplotlib` 程序化画的：

```python
import matplotlib
matplotlib.use('Agg')          # 无 GUI 后端，服务器可跑
import matplotlib.pyplot as plt
import matplotlib.patches as patches

plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'SimSun']
plt.rcParams['axes.unicode_minus'] = False    # 负号正常显示
```

`font.sans-serif` 指定中文字体链（雅黑 → 黑体 → 宋体 依次 fallback），`axes.unicode_minus = False` 解决中文环境下负号显示成方块的问题。这两行是 matplotlib 中文绘图必配。

配色与 PPT 令牌保持一致：

```python
COLORS = {
    'one_color': '#065A82',    # 二进制矩阵里的 1
    'zero_color': '#E8F4F8',   # 0
    'neg_color': '#FDE8E8',    # -1（浅红）
    'pos_color': '#D4E9F7',    # 正数（浅蓝）
    'highlight': '#F9E795',    # 高亮（金）
}
```

**语义化命名而非颜色名**——`one_color` / `neg_color` 而不是 `blue` / `red`。因为画的是算法数据结构（二进制矩阵、前缀和、单调栈），按**值的含义**配色比按颜色本身更清楚。

输出的 PNG 文件名带尺寸（`binary_vs_ternary_1000x500.png`），方便在 PPT 里按比例放置不用二次缩放。

## 五、附带工具：移除 PPT 的「AI 生成」水印

`remove_ai_tag.js` 是个独立后处理脚本。有些工具导出的 PPTX 会在母版里嵌入「AI 生成」标记，这个脚本直接改 zip 里的 XML：

```js
const zip = await JSZip.loadAsync(data);
const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));

for (const slideFile of slideFiles) {
  let content = await zip.file(slideFile).async("string");
  if (content.includes("AI 生成") || content.includes("AI\u751f\u6210")) {
    // 删掉包含该文本的整个 <p:sp>（形状）元素
    content = content.replace(/<p:sp>[\s\S]*?AI\s*生成[\s\S]*?<\/p:sp>/g, "");
    zip.file(slideFile, content);
  }
}
```

除了 slides，还扫 `slideMasters` 和 `slideLayouts`——水印常藏在母版里，只改 slides 不够。

中文字符做了双重匹配（字面 `AI 生成` 和 Unicode 转义 `AI\u751f\u6210`），因为 XML 里中文可能以转义形式存储。正则里所有空格都用 `\s*` 容错——「AI 生成」「AI生成」「AI 生成」都可能出现。

## 六、文件结构

```
├── gen-ppt/                     # 演示文稿生成脚本（每份对应一套主题）
│   ├── gen_ppt.js               # Ocean Gradient 主题 · 算法题解
│   ├── gen_ppt_v2.js            # 同上 · 修订版
│   ├── gen_ppt2.js              # 同上 · 第二版
│   ├── gen_ppt3_cn.js           # 纯中文版
│   ├── gen_ppt_stamp.js         # 印章题专题
│   ├── gen_ppt_salary.js        # 薪酬分析专题
│   └── generate_ppt.js          # Teal Horizon 主题 · 项目路演
├── gen-images/                  # matplotlib 算法可视化配图
│   ├── gen_images.py            # 基础版
│   ├── gen_images2.py
│   ├── gen_images_v2.py         # 增强版
│   ├── gen_images_salary.py     # 薪酬专题
│   ├── gen_images_stamp.py      # 印章专题
│   └── fix_images.py            # 批量修正尺寸/字体
├── remove_ai_tag.js             # 移除 PPTX 内的「AI 生成」水印
└── package.json
```

## 七、用法

```bash
npm install pptxgenjs
node gen-ppt/gen_ppt.js            # 生成 pptx

pip install matplotlib numpy
python gen-images/gen_images.py    # 生成配图 PNG
```

生成逻辑都在脚本末尾的 `main()` 或顶层顺序调用里，改内容直接改脚本。

## 许可证

MIT License
