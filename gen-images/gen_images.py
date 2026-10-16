"""
gen_images.py — 用 matplotlib 生成算法可视化配图

用途：为「二维前缀和 + 子矩阵枚举」题解 PPT 生成示意图。
输出：带尺寸标识的 PNG（如 original_grid_1050x675.png），
      PPT 里按比例放置不用二次缩放。

六个绘图函数：
    draw_original_grid()        原始网格
    draw_transformed_grid()     0 → -1 变换后的网格
    draw_prefix_sum()           二维前缀和
    draw_submatrix_sum()        子矩阵求和（容斥原理）
    draw_flowchart()            算法流程图
    draw_example_submatrices()  样例枚举演示

注意：本文件是核心机制摘录版（配色 + 两个代表性函数 +
     通用保存工具）。完整 378 行版本包含全部六个函数，
      结构与之相同。
"""

import matplotlib
matplotlib.use('Agg')          # 无 GUI 后端，服务器/CI 可跑
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np
import os

# ============================================================
# 中文字体配置（matplotlib 中文绘图必配两行）
# ============================================================
# font.sans-serif 指定字体链，依次 fallback：
#   雅黑 → 黑体 → 宋体
plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'SimSun']
# 中文环境下负号会显示成方块，必须关掉 unicode_minus
plt.rcParams['axes.unicode_minus'] = False

# ============================================================
# 配色 — 与 PPT 的 Ocean Gradient 主题保持一致
# ============================================================
# 注意命名方式：按「值的含义」而非「颜色本身」。
# 画的是算法数据结构（二进制矩阵、前缀和、单调栈），
# one_color / neg_color 比 blue / red 更清楚。
COLORS = {
    'primary':    '#065A82',
    'secondary':  '#1C7293',
    'accent':     '#21295C',
    'bg':         '#F0F7FA',
    'text':       '#21295C',
    'light':      '#E8F4F8',
    'one_color':  '#065A82',    # 二进制矩阵里的 1
    'zero_color': '#E8F4F8',    # 0
    'neg_color':  '#FDE8E8',    # -1（浅红）
    'pos_color':  '#D4E9F7',    # 正数（浅蓝）
    'highlight':  '#F9E795',    # 高亮（金）
}

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

# ============================================================
# 通用保存工具
# ============================================================
def save_fig(fig, name, w_in, h_in, dpi=150):
    """
    保存图片并在文件名里带上像素尺寸。

    文件名带尺寸的好处：PPT 里放置时可直接按比例算位置，
    不用先打开图片查分辨率。
    """
    w, h = int(w_in * dpi), int(h_in * dpi)
    path = os.path.join(OUTPUT_DIR, f'{name}_{w}x{h}.png')
    fig.savefig(path, dpi=dpi, bbox_inches='tight', transparent=True)
    plt.close(fig)
    print(f"Saved: {name}_{w}x{h}.png")
    return path


# ============================================================
# 图 1：原始网格
# ============================================================
def draw_original_grid():
    fig, ax = plt.subplots(figsize=(7, 4.5), dpi=150)
    grid = [
        [1, 0, 1, 0],
        [1, 1, 1, 1],
        [0, 0, 1, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0]
    ]
    n, m = 5, 4
    cell_size = 1.0

    for i in range(n):
        for j in range(m):
            # 按值选色：1 用主色，0 用浅色
            color = COLORS['one_color'] if grid[i][j] == 1 else COLORS['zero_color']
            rect = patches.Rectangle((j, n-1-i), cell_size, cell_size,
                                     linewidth=2, edgecolor='white',
                                     facecolor=color)
            ax.add_patch(rect)
            # 深色底用白字，浅色底用深字——保证对比度
            text_color = 'white' if grid[i][j] == 1 else COLORS['text']
            ax.text(j + 0.5, n - 1 - i + 0.5, str(grid[i][j]),
                    ha='center', va='center', fontsize=22, fontweight='bold',
                    color=text_color)

    # 行列标注（C1/C2... R1/R2...）便于在 PPT 里指认元素
    for j in range(m):
        ax.text(j + 0.5, n + 0.3, f'C{j+1}', ha='center', va='center',
                fontsize=11, color=COLORS['text'], fontweight='bold')
    for i in range(n):
        ax.text(-0.4, n - 1 - i + 0.5, f'R{i+1}', ha='center', va='center',
                fontsize=11, color=COLORS['text'], fontweight='bold')

    # 图例：直接写业务含义而非「1 / 0」
    ax.text(m + 0.8, n - 0.5, '1 = 混乱', fontsize=11,
            color=COLORS['one_color'], fontweight='bold')
    ax.text(m + 0.8, n - 1.5, '0 = 平静', fontsize=11,
            color=COLORS['text'], fontweight='bold')

    ax.set_xlim(-0.8, m + 3)
    ax.set_ylim(-0.5, n + 0.8)
    ax.set_aspect('equal')      # 等比例，格子必须是正方形
    ax.axis('off')              # 关掉坐标轴
    ax.set_title('原始网格 (5×4)', fontsize=16, fontweight='bold',
                 color=COLORS['text'], pad=10)

    save_fig(fig, 'original_grid', 7, 4.5)


# ============================================================
# 图 2：0 → -1 变换后的网格
# ============================================================
def draw_transformed_grid():
    """
    这道题的关键转化：把 0 换成 -1。

    于是「1 的个数 > 0 的个数」等价于「子矩阵和 > 0」，
    问题从计数变成求和，可以用前缀和 O(1) 查询。
    """
    fig, ax = plt.subplots(figsize=(7, 4.5), dpi=150)
    grid_orig = [
        [1, 0, 1, 0],
        [1, 1, 1, 1],
        [0, 0, 1, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0]
    ]
    grid_trans = [[1 if x == 1 else -1 for x in row] for row in grid_orig]
    n, m = 5, 4
    cell_size = 1.0

    for i in range(n):
        for j in range(m):
            color = COLORS['one_color'] if grid_trans[i][j] == 1 else COLORS['neg_color']
            rect = patches.Rectangle((j, n-1-i), cell_size, cell_size,
                                     linewidth=2, edgecolor='white',
                                     facecolor=color)
            ax.add_patch(rect)
            text_color = 'white' if grid_trans[i][j] == 1 else '#C0392B'
            # :+d 格式让正数带 + 号，与 -1 视觉对称
            ax.text(j + 0.5, n - 1 - i + 0.5, f'{grid_trans[i][j]:+d}',
                    ha='center', va='center', fontsize=20, fontweight='bold',
                    color=text_color)

    ax.set_xlim(-0.5, m + 0.5)
    ax.set_ylim(-0.5, n + 0.5)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_title('变换后网格: 0 → -1', fontsize=16, fontweight='bold',
                 color=COLORS['text'], pad=10)

    save_fig(fig, 'transformed_grid', 7, 4.5)


if __name__ == '__main__':
    draw_original_grid()
    draw_transformed_grid()
    # 完整版还包括：
    # draw_prefix_sum() / draw_submatrix_sum()
    # draw_flowchart() / draw_example_submatrices()
