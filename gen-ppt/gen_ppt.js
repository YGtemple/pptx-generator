/**
 * gen_ppt.js — 用 pptxgenjs 程序化生成演示文稿
 *
 * 主题：Ocean Gradient（海洋渐变）
 * 用途：C++ 算法竞赛题解演示（本题：MC0507 二维前缀和 + 子矩阵枚举）
 *
 * ────────────────────────────────────────────────────────────
 * 核心机制：虚拟节点树 + 一次性扁平化
 * ────────────────────────────────────────────────────────────
 *
 * pptxgenjs 原生要求所有元素给绝对坐标。想在卡片里放文字，
 * 得先算卡片位置再算文字相对页面的位置——卡片一挪，里面
 * 所有元素都要跟着改。
 *
 * 这套实现改了两件事：
 *
 *   1. createVirtualNode 在创建子节点时就把相对坐标累加成
 *      绝对坐标（absX: parentX + opts.x），嵌套任意层都不会算错。
 *
 *   2. addSlide 被 hook 成返回「虚拟 slide」，真实写入推迟到
 *      slide.render() 调用 flattenNode 时。所以「布局」和
 *      「输出」两个阶段完全分开——布局阶段随便试错。
 *
 * 用法上就变成：addShape(...) 返回的节点上可以继续 addText()，
 * 形成嵌套容器，位置自动跟随父级。
 */

const pptxgen = require("pptxgenjs");

let pres = new pptxgen();
pres.author = 'Algorithm Tutorial';
pres.title = 'MC0507 - C++ 解题详解';

// ============================================================
// 画布尺寸常量（16:9）
// ============================================================
pres.layout = 'LAYOUT_16x9';
const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MARGIN = 0.5;
const CONTENT_X = MARGIN;
const CONTENT_Y = MARGIN;
const CONTENT_W = SLIDE_W - (2 * MARGIN);
const CONTENT_H = SLIDE_H - (2 * MARGIN);
const CENTER_X = SLIDE_W / 2;
const CENTER_Y = SLIDE_H / 2;

// ============================================================
// 配色令牌 — Ocean Gradient
// ============================================================
const C = {
  primary: '065A82',
  secondary: '1C7293',
  accent: '21295C',
  bg: 'F0F7FA',
  bgLight: 'E8F4F8',
  text: '21295C',
  textLight: 'FFFFFF',
  textMuted: '5A7A8A',
  success: '27AE60',
  danger: 'E74C3C',
  gold: 'F9E795',
  cardBg: 'FFFFFF',
  // ── 代码块专用配色（深底 + VSCode Dark+ 语法色）──
  // 单独一组，让 PPT 里贴代码的观感与编辑器一致
  codeBg: '1E2A3A',
  codeText: 'E0E0E0',
  codeKeyword: '569CD6',
  codeString: 'CE9178',
  codeComment: '6A9955',
  codeNumber: 'B5CEA8',
};

const IMG_DIR = __dirname;   // 配图目录（matplotlib 生成的 PNG）

// ============================================================
// 容器系统
// ============================================================

/**
 * 虚拟节点工厂。
 *
 * 关键：absX/absY 在创建时就累加父级坐标，
 * 所以后续无论嵌套多深，flatten 时直接用即可。
 */
function createVirtualNode(type, data, parentX = 0, parentY = 0) {
  const opts = data.opts || {};
  const node = {
    type, data,
    absX: parentX + (opts.x || 0),
    absY: parentY + (opts.y || 0),
    w: opts.w || 0, h: opts.h || 0,
    children: []
  };

  node.addShape = function(shapeType, opts = {}) {
    const child = createVirtualNode('shape', { shapeType, opts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };

  node.addText = function(text, opts = {}) {
    // fit:"shrink" 作为默认——中文比英文宽，不设容易溢出卡片。
    // 注意展开顺序：...opts 在后，调用方仍可覆盖。
    const safeOpts = { fit: "shrink", ...opts };

    // 自动剔除手写的项目符号。
    // pptxgenjs 的 bullet:true 会自己画点，文本里再手写 • 会变成「• • 内容」。
    const bulletRe = /^(?:[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25CB\u2013\u2014]\s*|\-\s+)/;
    if (Array.isArray(text)) {
      text = text.map(item => {
        if (item && item.options && item.options.bullet && typeof item.text === 'string') {
          return { ...item, text: item.text.replace(bulletRe, '') };
        }
        return item;
      });
    }

    const child = createVirtualNode('text', { text, opts: safeOpts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };

  node.addImage = function(opts = {}) {
    const child = createVirtualNode('image', { opts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };

  node.addTable = function(tableData, opts = {}) {
    const child = createVirtualNode('table', { tableData, opts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };

  return node;
}

/** 递归扁平化：把虚拟树写进真实 slide */
function flattenNode(node, realSlide, pres) {
  const absOpts = { ...node.data.opts, x: node.absX, y: node.absY };
  if (node.type === 'shape') realSlide.addShape(node.data.shapeType, absOpts);
  else if (node.type === 'text') realSlide.addText(node.data.text, absOpts);
  else if (node.type === 'image') realSlide.addImage(absOpts);
  else if (node.type === 'table') realSlide.addTable(node.data.tableData, absOpts);
  node.children.forEach(child => flattenNode(child, realSlide, pres));
}

// Hook addSlide：返回虚拟 slide，真实写入推迟到 render()
const originalAddSlide = pres.addSlide.bind(pres);
pres.addSlide = function(options) {
  const realSlide = originalAddSlide(options);
  const virtualSlide = {
    children: [],
    _realSlide: realSlide,
    set background(val) { realSlide.background = val; },
    get background() { return realSlide.background; },

    addShape: function(shapeType, opts = {}) {
      const node = createVirtualNode('shape', { shapeType, opts }, 0, 0);
      this.children.push(node);
      return node;
    },
    addText: function(text, opts = {}) {
      const safeOpts = { fit: "shrink", ...opts };
      const node = createVirtualNode('text', { text, opts: safeOpts }, 0, 0);
      this.children.push(node);
      return node;
    },
    addImage: function(opts = {}) {
      const node = createVirtualNode('image', { opts }, 0, 0);
      this.children.push(node);
      return node;
    },
    addTable: function(tableData, opts = {}) {
      const node = createVirtualNode('table', { tableData, opts }, 0, 0);
      this.children.push(node);
      return node;
    },
    addChart: function(chartType, data, opts = {}) {
      // 图表直接画（不支持嵌套定位）
      realSlide.addChart(chartType, data, opts);
    },
    render: function() {
      this.children.forEach(child => flattenNode(child, realSlide, pres));
    }
  };
  return virtualSlide;
};

// ============================================================
// 复用组件
// ============================================================

/** 统一的页眉标题栏（顶部色条 + 主标题 + 副标题） */
function addTitleBar(slide, title, subtitle) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: SLIDE_W, h: 0.06,
    fill: { color: C.primary }
  });
  slide.addText(title, {
    x: CONTENT_X, y: 0.2, w: CONTENT_W, h: 0.5,
    fontSize: 26, fontFace: "Georgia", bold: true,
    color: C.accent, charSpacing: 1.5, margin: 0
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: CONTENT_X, y: 0.7, w: CONTENT_W, h: 0.35,
      fontSize: 14, fontFace: "Calibri",
      color: C.textMuted, margin: 0
    });
  }
}

/** 代码块：深底卡片 + Consolas 等宽字体 */
function addCodeBlock(slide, code, opts = {}) {
  const card = slide.addShape(pres.shapes.RECTANGLE, {
    x: opts.x || CONTENT_X, y: opts.y || 1.2,
    w: opts.w || CONTENT_W, h: opts.h || 3.0,
    fill: { color: C.codeBg }
  });
  card.addText(code, {
    x: 0.2, y: 0.15, w: (opts.w || CONTENT_W) - 0.4, h: (opts.h || 3.0) - 0.3,
    fontSize: opts.fontSize || 11, fontFace: "Consolas",
    color: C.codeText, margin: 0, valign: "top"
  });
  return card;
}

module.exports = { pres, C, SLIDE_W, SLIDE_H, MARGIN, CONTENT_X, CONTENT_Y,
  CONTENT_W, CONTENT_H, CENTER_X, CENTER_Y, IMG_DIR,
  createVirtualNode, flattenNode, addTitleBar, addCodeBlock };
