// 毎朝の実行エントリポイント:  node src/main.js
//   --skip-scrape  … SUUMO取得を飛ばして既存DBで再計算（判定ロジックの調整用）
//   --city=27207   … 指定した区市だけ取得（動作確認用）
import { SCRAPE } from './config.js';
import { todayJST, sleep } from './util.js';
import { scrapeAll, scrapeCity, scrapeDetail } from './suumo.js';
import { loadTransactions } from './reinfolib.js';
import * as store from './store.js';
import { analyze, areaStats } from './analyze.js';
import { writeOutputs } from './output.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const today = todayJST();
const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...m);

let db = store.load();

if (!args['skip-scrape']) {
  log('SUUMO 一覧を取得中…');
  const scraped = args.city ? await scrapeCity(args.city, log) : await scrapeAll(log);
  // 取得件数が前回の半分未満なら異常（ブロック・HTML変更など）として止める
  const prevActive = Object.values(db).filter((x) => x.lastSeen === Object.values(db).reduce((m, y) => (y.lastSeen > m ? y.lastSeen : m), '')).length;
  if (!args.city && prevActive > 1000 && scraped.length < prevActive * 0.5) {
    throw new Error(`取得件数が異常に少ない（${scraped.length}件 / 前回${prevActive}件）。SUUMO側の変更かアクセス制限の可能性`);
  }
  log(`  取得 ${scraped.length}件`);
  db = store.merge(db, scraped, today);
}

log('成約データを読み込み中…');
const tx = await loadTransactions(log);

log('割安判定（1回目）…');
let { results } = analyze(db, tx, today);

// 割安候補だけ詳細ページを取りに行き（キャッシュ済みは除く）、注意フラグを付けて再判定
const need = results.filter((x) => x.rating && !db[x.id].detail).sort((a, b) => a.score - b.score).slice(0, SCRAPE.maxDetailPerRun);
if (need.length && !args['skip-scrape']) {
  log(`詳細ページ取得 ${need.length}件…`);
  for (const x of need) {
    try { db[x.id].detail = await scrapeDetail(x.url); } catch (e) { log('  詳細取得失敗', x.id, e.message); }
    await sleep(SCRAPE.delayMs);
  }
}
store.save(db);

const out = analyze(db, tx, today);
const stats = areaStats(out.results, tx);
await writeOutputs({ ...out, stats, today, updatedAt: new Date().toISOString(), txCount: tx.length });
log(`完了: 掲載${out.results.length}件 / ★${out.results.filter((x) => x.rating === '★割安').length} / 要確認${out.results.filter((x) => x.rating === '要確認').length} / 理論値R²=${out.model.r2}`);
