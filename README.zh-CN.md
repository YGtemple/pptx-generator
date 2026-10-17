<div align="right">

[English](README.md) · **[简体中文](README.zh-CN.md)**

</div>

# pptx-generator

用代码生成演示文稿——虚拟节点树自动算坐标，另配 matplotlib 画算法图示。

<sub>JavaScript · Python · `pptxgenjs` + `matplotlib`</sub>

---

## 问题：坐标要手算

`pptxgenjs` 要求每个元素给绝对坐标。想在卡片里放文字，得先定位卡片，再算文字相对页面的位置。卡片一挪，里面所有东西都要重算。

这套实现把这件事去掉了。

### 虚拟节点

```js
function createVirtualNode(type, data, parentX = 0, parentY = 0) {
  const opts = data.opts || {};
  const node = {
    type, data,
    absX: parentX + (opts.x || 0),   // 父级偏移在这里累加
    absY: parentY + (opts.y || 0),
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

关键在 `absX: parentX + (opts.x || 0)` 这一行。每层的相对偏移在创建时就解析成绝对位置，嵌套多少层都不会算错。

最后一次性展开：

```js
function flattenNode(node, realSlide, pres) {
  const absOpts = { ...node.data.opts, x: node.absX, y: node.absY };
  if (node.type === 'shape') realSlide.addShape(node.data.shapeType, absOpts);
  else if (node.type === 'text')  realSlide.addText(node.data.text, absOpts);
  else if (node.type === 'image') realSlide.addImage(absOpts);
  else if (node.type === 'table') realSlide.addTable(node.data.tableData, absOpts);
  node.children.forEach(child => flattenNode(child, realSlide, pres));
}
```

`addSlide` 也被包了一层：返回虚拟 slide，直到 `render()` 才真正写入。布局和输出因此分成两个阶段——布局阶段可以随便试错。

## 两个值得留的细节

### 剔除手写的项目符号

```js
const bulletRe = /^(?:[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25CB\u2013\u2014]\s*|\-\s+)/;
```

`pptxgenjs` 的 `bullet: true` 会自己画项目符号。如果文本里已经手写了 `•`，渲染出来就是两个点。正则覆盖九种常见项目符号字符外加 `- `，在传给 `addText` 前统一剥掉。

### 把 `fit: "shrink"` 设成默认

```js
node.addText = function(text, opts = {}) {
  const safeOpts = { fit: "shrink", ...opts };
  ...
}
```

文字超出时自动缩小而不是溢出。作为默认值（注意 `...opts` 在后，调用方仍可覆盖），能挡掉大部分「中文比英文宽，结果撑出卡片」的情况。

## 配色

每套 PPT 一组令牌，按主题命名：

```js
// Ocean Gradient——算法讲解用
const C = {
  primary:   '065A82',
  secondary: '1C7293',
  accent:    '21295C',
  bg:        'F0F7FA',
  codeBg:      '1E2A3A',
  codeText:    'E0E0E0',
  codeKeyword: '569CD6',
  codeString:  'CE9178',
  codeComment: '6A9955',
  codeNumber:  'B5CEA8',
};
```

代码块单独一组配色：深底 `1E2A3A` 配 VSCode Dark+ 的语法色，贴进幻灯片的代码看起来和编辑器里一致。

字体分三档：

```js
const FONT_T = "Georgia";           // 标题——衬线，正式
const FONT_B = "Calibri";           // 正文
const FONT_CJK = "Microsoft YaHei"; // 中文
```

## 算法配图

图不是截图，是 `matplotlib` 画的：

```python
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches

plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'SimSun']
plt.rcParams['axes.unicode_minus'] = False
```

这两行 `rcParams` 是 matplotlib 中文绘图的最低配置。第一行给出回退链（雅黑 → 黑体 → 宋体）；第二行防止负号显示成方块。

配色与幻灯片令牌一致：

```python
COLORS = {
    'one_color':  '#065A82',    # 二进制矩阵里的 1
    'zero_color': '#E8F4F8',    # 0
    'neg_color':  '#FDE8E8',    # -1
    'pos_color':  '#D4E9F7',    # 正数
    'highlight':  '#F9E795',    # 高亮
}
```

按含义命名而非按颜色——画的是算法数据结构（二进制矩阵、前缀和），`one_color` 比 `blue` 说明更多。

输出文件名带像素尺寸（`binary_vs_ternary_1000x500.png`），放进幻灯片不用再量一次。

## 去掉「AI 生成」水印

`remove_ai_tag.js` 是独立的后处理脚本。有些导出工具会把水印嵌进幻灯片母版；这个脚本直接改 pptx 压缩包里的 XML：

```js
const zip = await JSZip.loadAsync(data);
const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));

for (const slideFile of slideFiles) {
  let content = await zip.file(slideFile).async("string");
  if (content.includes("AI 生成") || content.includes("AI\u751f\u6210")) {
    content = content.replace(/<p:sp>[\s\S]*?AI\s*生成[\s\S]*?<\/p:sp>/g, "");
    zip.file(slideFile, content);
  }
}
```

三件事值得注意：

- 也会扫 `slideMasters` 和 `slideLayouts`——水印通常藏在母版里，只处理 `slides/*.xml` 会漏。
- 中文同时按字面和 `\u` 转义匹配，因为 XML 里两种形式都可能出现。
- 空格做了容错（`AI\s*生成`），不同导出工具的空格不一致。

## 目录

```
gen-ppt/                 每套主题一个脚本
├── gen_ppt.js           Ocean Gradient · 算法讲解
├── gen_ppt_v2.js        同主题修订版
├── gen_ppt2.js          同主题第二版
├── gen_ppt3_cn.js       纯中文
├── gen_ppt_stamp.js     印章题
├── gen_ppt_salary.js    薪酬分析
└── generate_ppt.js      Teal Horizon · 项目路演
gen-images/              matplotlib 配图
├── gen_images.py
├── gen_images2.py
├── gen_images_v2.py
├── gen_images_salary.py
├── gen_images_stamp.py
└── fix_images.py
remove_ai_tag.js
package.json
```

## 用法

```bash
npm install pptxgenjs
node gen-ppt/gen_ppt.js

pip install matplotlib numpy
python gen-images/gen_images.py
```

## 许可证

MIT
