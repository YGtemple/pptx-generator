<div align="right">

**[English](README.md)** · [简体中文](README.zh-CN.md)

</div>

# pptx-generator

Generate presentations in code — a virtual node tree computes coordinates, plus matplotlib figures for the diagrams.

<sub>JavaScript · Python · `pptxgenjs` + `matplotlib`</sub>

---

## The problem: coordinates you have to do by hand

`pptxgenjs` wants every element at an absolute position. Put text inside a card and you first locate the card, then work out the text's position relative to the page. Move the card and everything inside it has to be recalculated.

This library removes that.

### Virtual nodes

```js
function createVirtualNode(type, data, parentX = 0, parentY = 0) {
  const opts = data.opts || {};
  const node = {
    type, data,
    absX: parentX + (opts.x || 0),   // parent offset accumulates here
    absY: parentY + (opts.y || 0),
    children: []
  };

  node.addShape = function(shapeType, opts = {}) {
    const child = createVirtualNode('shape', { shapeType, opts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };
  // addText / addImage / addTable follow the same pattern
  return node;
}
```

The line that matters is `absX: parentX + (opts.x || 0)`. Each level's relative offset resolves into an absolute position **at construction time**, so nesting any number of levels stays correct.

The tree is flattened once, at the end:

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

`addSlide` is wrapped too: it returns a virtual slide rather than a real one, and nothing is written until `render()` runs. Layout and output become separate phases — the layout phase can be wrong as many times as it needs to be.

## Two details worth keeping

### Stripping hand-written bullets

```js
const bulletRe = /^(?:[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25CB\u2013\u2014]\s*|\-\s+)/;
```

`pptxgenjs` draws its own bullet when `bullet: true`. If the text already starts with `•`, you get two. The regex covers nine common bullet characters plus `- ` and strips them before they reach `addText`.

### `fit: "shrink"` as a default

```js
node.addText = function(text, opts = {}) {
  const safeOpts = { fit: "shrink", ...opts };
  ...
}
```

Text shrinks to fit rather than overflowing. As a default (note `...opts` comes last, so callers can override), this removes most of the "Chinese is wider than Latin, so it spills out of the card" cases.

## Colour

Each deck carries one set of tokens, named after its theme:

```js
// Ocean Gradient — algorithm walkthroughs
const C = {
  primary:   '065A82',
  secondary: '1C7293',
  accent:    '21295C',
  bg:        'F0F7FA',
  // code blocks get their own set — dark ground, VSCode syntax colours
  codeBg:      '1E2A3A',
  codeText:    'E0E0E0',
  codeKeyword: '569CD6',
  codeString:  'CE9178',
  codeComment: '6A9955',
  codeNumber:  'B5CEA8',
};
```

`1E2A3A` with VSCode Dark+ syntax colours means code pasted into a slide looks like the editor it came from.

Fonts are split three ways:

```js
const FONT_T = "Georgia";           // titles — serif, formal
const FONT_B = "Calibri";           // body
const FONT_CJK = "Microsoft YaHei"; // Chinese
```

## Algorithm figures

The diagrams are not screenshots — `matplotlib` draws them:

```python
import matplotlib
matplotlib.use('Agg')          # no GUI backend, runs headless
import matplotlib.pyplot as plt
import matplotlib.patches as patches

plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'SimSun']
plt.rcParams['axes.unicode_minus'] = False    # minus signs, not tofu
```

Those two `rcParams` lines are the minimum for CJK in matplotlib. The first gives a fallback chain (YaHei → SimHei → SimSun); the second stops minus signs rendering as boxes.

Colours match the slide tokens:

```python
COLORS = {
    'one_color':  '#065A82',    # 1 in a binary matrix
    'zero_color': '#E8F4F8',    # 0
    'neg_color':  '#FDE8E8',    # -1
    'pos_color':  '#D4E9F7',    # positive values
    'highlight':  '#F9E795',    # highlight
}
```

Named by meaning, not by colour — these draw algorithm data structures (binary matrices, prefix sums), so `one_color` says more than `blue`.

Output filenames carry their pixel size (`binary_vs_ternary_1000x500.png`), so placing them in a slide needs no second measurement.

## Removing an "AI generated" watermark

`remove_ai_tag.js` is a standalone post-processor. Some exporters embed the watermark in the slide master; the script edits the XML inside the pptx zip directly:

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

Three things matter here:

- It also scans `slideMasters` and `slideLayouts` — the watermark usually lives in the master, so touching only `slides/*.xml` misses it.
- Chinese is matched both literally and as `\u` escapes, because XML may store either.
- Spacing is tolerated (`AI\s*生成`) since exporters vary.

## Layout

```
gen-ppt/                 one script per theme
├── gen_ppt.js           Ocean Gradient · algorithm walkthroughs
├── gen_ppt_v2.js        same, revised
├── gen_ppt2.js          same, second pass
├── gen_ppt3_cn.js       Chinese only
├── gen_ppt_stamp.js     seal/stamp topic
├── gen_ppt_salary.js    salary analysis topic
└── generate_ppt.js      Teal Horizon · project pitch
gen-images/              matplotlib figures
├── gen_images.py
├── gen_images2.py
├── gen_images_v2.py
├── gen_images_salary.py
├── gen_images_stamp.py
└── fix_images.py
remove_ai_tag.js
package.json
```

## Usage

```bash
npm install pptxgenjs
node gen-ppt/gen_ppt.js

pip install matplotlib numpy
python gen-images/gen_images.py
```

## License

MIT
