export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function todayJST() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

// "1億2000万円" / "2980万円" / "2980万円～3200万円" → 万円単位の数値
export function parseManYen(s) {
  if (!s) return null;
  const m = s.replace(/[,\s]/g, '').match(/(?:(\d+)億)?(?:(\d+(?:\.\d+)?)万)?円/);
  if (!m || (!m[1] && !m[2])) return null;
  return (Number(m[1] || 0) * 10000) + Number(m[2] || 0);
}

// "4000円／月" / "1万6000円／月" → 円
export function parseYen(s) {
  if (!s) return null;
  const m = s.replace(/[,\s]/g, '').match(/(?:(\d+)万)?(\d+)?円/);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] || 0) * 10000 + Number(m[2] || 0);
}

export function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

export const round = (x, d = 0) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

// 全角英数→半角、空白除去（住所や駅名の突き合わせ用）
export function norm(s) {
  return (s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]/g, '');
}
