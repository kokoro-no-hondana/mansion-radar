// 国交省「不動産情報ライブラリ」API（XIT001: 不動産価格（取引価格・成約価格）情報）
// 中古マンションの成約価格・取引価格を四半期×市区町村ごとに取得し、data/transactions.json にキャッシュする。
import fs from 'node:fs';
import { CITIES, JUDGE, TSUBO_PER_SQM } from './config.js';
import { sleep, norm } from './util.js';

const ENDPOINT = 'https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001';
const CACHE = 'data/transactions.json';

// 直近 n 四半期（公表ラグを考慮し、今期は含めない）
function recentQuarters(n) {
  const d = new Date();
  let y = d.getFullYear();
  let q = Math.floor(d.getMonth() / 3) + 1;
  const out = [];
  for (let i = 0; i < n + 1; i++) {
    q--; if (q === 0) { q = 4; y--; }
    out.push(`${y}Q${q}`);
  }
  return out;
}

const num = (s) => {
  const m = String(s ?? '').replace(/,/g, '').match(/[\d.]+/);
  return m ? Number(m[0]) : null;
};

function toRecord(r, quarter) {
  if (!String(r.Type || '').includes('中古マンション')) return null;
  const price = num(r.TradePrice);            // 円
  const area = num(r.Area);                   // ㎡
  if (!price || !area || area < JUDGE.minAreaForModel) return null;
  const by = num(r.BuildingYear);
  return {
    q: quarter,
    kind: String(r.PriceCategory || '').includes('成約') ? '成約' : '取引',
    cityCode: String(r.MunicipalityCode),
    district: norm(r.DistrictName),
    price: price / 1e4,                       // 万円
    area,
    builtYear: by && by > 1900 ? by : null,
    layout: norm(r.FloorPlan),
    tsuboPrice: Math.round((price / 1e4 / (area * TSUBO_PER_SQM)) * 10) / 10,
  };
}

// 週1回（月曜）または未取得の四半期があるときだけAPIを叩く
export async function loadTransactions(log = console.log) {
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : { fetched: {}, rows: [] };
  const key = process.env.REINFOLIB_API_KEY;
  if (!key) {
    log('  REINFOLIB_API_KEY 未設定のため成約データの更新をスキップ');
    return cache.rows;
  }
  const quarters = recentQuarters(JUDGE.seiyakuQuarters);
  const isMonday = new Date(Date.now() + 9 * 3600e3).getUTCDay() === 1;
  let calls = 0;
  for (const yq of quarters) {
    const [year, quarter] = yq.split('Q');
    for (const city of Object.keys(CITIES)) {
      const k = `${yq}-${city}`;
      // 直近2四半期は毎週取り直す（遅れて追加される事例があるため）
      const fresh = quarters.indexOf(yq) < 2 && isMonday;
      if (cache.fetched[k] && !fresh) continue;
      const res = await fetch(`${ENDPOINT}?year=${year}&quarter=${quarter}&city=${city}`, {
        headers: { 'Ocp-Apim-Subscription-Key': key },
      });
      calls++;
      // 該当データなしは 404 で返る仕様
      if (!res.ok && res.status !== 404) { log(`  API ${k}: HTTP ${res.status}`); await sleep(1000); continue; }
      const json = res.status === 404 ? { data: [] } : await res.json();
      cache.rows = cache.rows.filter((r) => !(r.q === yq && r.cityCode === city));
      for (const r of json.data || []) {
        const rec = toRecord(r, yq);
        if (rec) cache.rows.push(rec);
      }
      cache.fetched[k] = new Date().toISOString();
      await sleep(300);
    }
  }
  // 古い四半期を捨てる
  cache.rows = cache.rows.filter((r) => quarters.includes(r.q));
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  log(`  成約・取引データ: ${cache.rows.length}件（API呼び出し ${calls}回）`);
  return cache.rows;
}
