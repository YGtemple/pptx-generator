// Post-processing script to remove "AI 生成" watermark from PPTX
//
// 背景：有些工具导出的 PPTX 会在母版（slideMaster）里嵌入
// "AI 生成" 标记。这个脚本直接改 pptx 的 zip 内 XML，
// 把包含该文本的整个 <p:sp>（形状）元素删掉。
//
// 用法：改下面的 pptxPath，然后 node remove_ai_tag.js
//
// 依赖：jszip

const JSZip = require("jszip");
const fs = require("fs");

const pptxPath = "path/to/your.pptx";

async function removeAiTag() {
  console.log("Reading PPTX file...");
  const data = fs.readFileSync(pptxPath);
  const zip = await JSZip.loadAsync(data);

  let modified = false;

  // 中文字符做双重匹配：字面 + Unicode 转义。
  // XML 里中文可能以 \uXXXX 形式存储，只匹配字面会漏。
  const hasTag = (s) => s.includes("AI 生成") || s.includes("AI\u751f\u6210");

  // 正则说明：
  //   <p:sp>...</p:sp>  匹配整个形状元素（含内嵌的文本段落）
  //   [\s\S]*?          非贪婪跨行匹配
  //   AI\s*生成         容错空格——"AI 生成"/"AI生成"/"AI  生成" 都可能出现
  const stripShape = (s) => s
    .replace(/<p:sp>[\s\S]*?AI\s*生成[\s\S]*?<\/p:sp>/g, "")
    .replace(/<p:sp>[\s\S]*?AI\s*\u751f\u6210[\s\S]*?<\/p:sp>/g, "");

  // ---------- 1. 幻灯片 ----------
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));

  for (const slideFile of slideFiles) {
    const content = await zip.file(slideFile).async("string");
    if (!hasTag(content)) continue;

    console.log(`Found "AI 生成" in ${slideFile}, removing...`);
    zip.file(slideFile, stripShape(content));
    modified = true;
  }

  // ---------- 2. 母版与版式 ----------
  // 这一步不能省：水印通常藏在母版里，只处理 slides 不够。
  const masterFiles = Object.keys(zip.files)
    .filter(f => /ppt\/(slideMasters|slideLayouts)\/.+\.xml$/.test(f));

  for (const masterFile of masterFiles) {
    const content = await zip.file(masterFile).async("string");
    if (!hasTag(content)) continue;

    console.log(`Found "AI 生成" in ${masterFile}, removing...`);
    zip.file(masterFile, stripShape(content));
    modified = true;
  }

  // ---------- 3. 回写 ----------
  if (modified) {
    console.log("Saving modified PPTX...");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    fs.writeFileSync(pptxPath, buf);
    console.log("Done! AI tag removed.");
  } else {
    console.log("No AI tag found in any slide.");
  }
}

removeAiTag().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
