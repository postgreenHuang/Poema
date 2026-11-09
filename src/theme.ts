export const defaultTheme = {
  canvas: "#f7f6f2",
  sidebar: "#e9ecdf",
  surface: "#fffefa",
  ink: "#34352e",
  muted: "#829080",
  accent: "#476f52",
  border: "#d9dfd4",
  poem: "#3b4038",
} as const;

export type ThemeColors = { -readonly [K in keyof typeof defaultTheme]: string };
export type ThemePart = keyof ThemeColors;
export const themeParts: { key: ThemePart; label: string; hint: string }[] = [
  { key: "canvas", label: "页面底色", hint: "阅读区与页面留白" },
  { key: "sidebar", label: "侧栏底色", hint: "导航与书架" },
  { key: "surface", label: "卡片底色", hint: "搜索结果、设置与弹窗" },
  { key: "ink", label: "标题文字", hint: "标题与主要信息" },
  { key: "poem", label: "诗歌正文", hint: "诗句的专属墨色" },
  { key: "muted", label: "次要文字", hint: "作者、说明与注释" },
  { key: "accent", label: "强调色", hint: "按钮、选中状态与链接" },
  { key: "border", label: "分隔线", hint: "卡片边框与细线" },
];

export const themePresets: { name: string; colors: ThemeColors }[] = [
  { name: "松烟", colors: { ...defaultTheme } },
  { name: "夜读", colors: { canvas: "#181d1b", sidebar: "#202a26", surface: "#252d29", ink: "#e9e9dc", muted: "#a6b5a7", accent: "#a2c8a5", border: "#445249", poem: "#e2e5d9" } },
  { name: "旧纸", colors: { canvas: "#f3ebd9", sidebar: "#e7dac2", surface: "#fbf4e6", ink: "#4d392c", muted: "#806d5d", accent: "#9b604a", border: "#d9c8af", poem: "#47382f" } },
];

const storageKey = "poema.theme.v1";
const hexColor = /^#[0-9a-fA-F]{6}$/;

export function loadTheme(): ThemeColors {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null") as Partial<ThemeColors> | null;
    if (!stored || typeof stored !== "object") return { ...defaultTheme };
    const result = { ...defaultTheme } as ThemeColors;
    for (const { key } of themeParts) if (typeof stored[key] === "string" && hexColor.test(stored[key])) result[key] = stored[key];
    return result;
  } catch { return { ...defaultTheme }; }
}

export function saveTheme(colors: ThemeColors) { localStorage.setItem(storageKey, JSON.stringify(colors)); }

export function applyTheme(colors: ThemeColors) {
  for (const { key } of themeParts) document.documentElement.style.setProperty(`--theme-${key}`, colors[key]);
  const channel = colors.canvas.match(/[0-9a-f]{2}/gi)?.map(value => parseInt(value, 16)) || [255, 255, 255];
  document.documentElement.style.colorScheme = channel[0] * .2126 + channel[1] * .7152 + channel[2] * .0722 < 128 ? "dark" : "light";
}
