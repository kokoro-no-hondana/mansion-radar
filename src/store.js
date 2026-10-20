// 物件の履歴DB（data/listings.json）。初掲載日・最終確認日・価格履歴・詳細情報を保持する。
import fs from 'node:fs';

const FILE = 'data/listings.json';
const KEEP_DAYS = 730; // 掲載終了から2年で削除（同じ建物の過去事例として使う期間）

export function load() {
  return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
}

export function save(db) {
  fs.writeFileSync(FILE, JSON.stringify(db));
}

// 住所は業者によって番地の書き方が違うので「丁目」までで比較する
export const addrKey = (a) => (a || '').replace(/[－ー−‐]/g, '-').replace(/-.*$/, '');
// 同一住戸が複数業者から掲載されている場合の重複キー
export const unitKey = (x) => [addrKey(x.address), x.builtYM, x.area, x.layout].join('|');
export const dupKey = (x) => unitKey(x) + '|' + x.price;
// 同じ建物の判定キー（所在地＋築年月）
export const buildingKey = (x) => (x.builtYM ? `${addrKey(x.address)}|${x.builtYM}` : null);

export function merge(db, scraped, today) {
  for (const x of scraped) {
    const prev = db[x.id];
    if (!prev) {
      db[x.id] = { ...x, firstSeen: today, lastSeen: today, prices: [[today, x.price]] };
      continue;
    }
    const last = prev.prices[prev.prices.length - 1];
    if (last[1] !== x.price) prev.prices.push([today, x.price]);
    Object.assign(prev, x, { lastSeen: today });
  }
  const cutoff = new Date(Date.parse(today) - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  for (const [id, x] of Object.entries(db)) if (x.lastSeen < cutoff) delete db[id];
  return db;
}
