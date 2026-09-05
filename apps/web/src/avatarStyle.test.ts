import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 头像居中闸门（P5，主人反馈「粉圈里面的头像位置漂移不居中」）。
 *
 * .avatar 是个「两用类」：<button>（顶栏 / 页头的用户菜单）与 <span>（管理中心用户表格 /
 * 个人中心身份卡）都挂它。span 默认是 inline 元素，缺 display 时 width / height 直接失效，
 * 圆只能由 border-radius 套在行盒上，字符再被 body 的 line-height 与字体基线带着跑——
 * 于是圈是圈、字是字。这里把「居中四件套 + 清零 UA 内边距」钉死，
 * 防止日后重构样式表时又把它退回成纯配色块。
 */
const read = (rel: string) => {
  const p = fileURLToPath(new URL(rel, import.meta.url));
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

/** 取「选择器 + 空格 + 左花括号」那条规则的内容（注释里不含花括号，故可直接找到块尾） */
function cssBlock(css: string, selector: string): string {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return '';
  const end = css.indexOf('}', at);
  return css.slice(at + selector.length, end < 0 ? undefined : end);
}

describe('头像居中（.avatar）', () => {
  const layout = read('./styles/layout.css');
  const base = read('./styles/base.css');

  it('.avatar 基础块存在且全站只定义一次（多处定义会互相覆盖尺寸）', () => {
    expect(layout.split('.avatar {').length - 1, '.avatar 基础块被写重复了').toBe(1);
    expect(cssBlock(layout, '.avatar').length).toBeGreaterThan(0);
  });

  it('居中四件套 + 行高与内边距清零都在', () => {
    const b = cssBlock(layout, '.avatar');
    for (const need of [
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'line-height: 1',
      'padding: 0',
      'vertical-align: middle',
      'flex: none',
    ]) {
      expect(b, '.avatar 缺 ' + need + '——span 档会退回 inline，宽高失效、字符随基线漂移').toContain(need);
    }
  });

  it('尺寸档只管边长与字号，对齐统一由 .avatar 负责', () => {
    for (const cls of ['.avatar-sm', '.avatar-xs', '.avatar-lg', '.avatar-xl']) {
      const b = cssBlock(base, cls);
      expect(b.length, '缺尺寸档 ' + cls).toBeGreaterThan(0);
      expect(b, cls + ' 不该重复写对齐规则').not.toMatch(/align-items|justify-content|display/);
    }
  });

  it('三处头像调用点齐全（button 档走 UserMenu 的 avatarClassName）', () => {
    // Phase 6 管理中心拆分：用户表格从 AdminPage.tsx 移到 pages/admin/UserTable.tsx，
    // 这里跟着改路径——断言的语义没变：span 档头像必须仍然带「.avatar + 尺寸档」两个类。
    expect(read('./pages/admin/UserTable.tsx')).toContain('className="avatar avatar-xs"');
    expect(read('./pages/ProfilePage.tsx')).toContain('className="avatar avatar-xl"');
    expect(read('./components/AppHeader.tsx')).toContain('avatarClassName="avatar avatar-sm"');
  });
});
