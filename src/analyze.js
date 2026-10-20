// 割安判定。1物件につき最大4つの物差しで坪単価を比べる。
//   model    : 駅・区・町名・築年・面積・徒歩を補正した理論坪単価（リッジ回帰）
//   （peer・building は駅・徒歩・築年・面積の差を理論値の比で補正したうえで比較）
//   peer     : 同じ駅（なければ同じ区）・築年±5年・面積±20%・徒歩±5分 の掲載物件の中央値
//   building : 同じ建物（所在地＋築年月）の他住戸（現在＋過去2年の掲載）の中央値
//   seiyaku  : 国交省APIの成約価格（同じ町→同じ区、築年±5年・面積±20%）の中央値
import { JUDGE } from './config.js';
import { median, round } from './util.js';
import { dupKey, unitKey, buildingKey, addrKey } from './store.js';

const ageOf = (ym, now) => (ym ? (now - Date.parse(ym + '-01')) / (365.25 * 864e5) : null);
const dev = (x, base) => (base ? x / base - 1 : null);

// ---------- リッジ回帰 ----------
function fitModel(rows) {
  const stCount = {};
  rows.forEach((r) => { if (r.station) stCount[r.station] = (stCount[r.station] || 0) + 1; });
  const stations = Object.keys(stCount).filter((s) => stCount[s] >= 3);
  const cities = [...new Set(rows.map((r) => r.cityCode))];
  // 町名（同じ区でも丘陵地・駅前などで相場が大きく違うため）
  const dk = (r) => r.cityCode + r.district;
  const dCount = {};
  rows.forEach((r) => { dCount[dk(r)] = (dCount[dk(r)] || 0) + 1; });
  const districts = Object.keys(dCount).filter((d) => dCount[d] >= 3);
  const contNames = ['age', 'age2', 'oldQuake', 'logArea', 'logArea2', 'walk', 'walk10', 'walk20', 'bus'];
  const cont = (r) => {
    const w = Math.min(r.walk ?? 15, 45), la = Math.log(r.area);
    return [r.age, r.age * r.age / 100, r.builtYM < '1981-06' ? 1 : 0, la, (la - 4.2) ** 2, w, Math.max(w - 10, 0), Math.max(w - 20, 0), r.bus ? 1 : 0];
  };

  // 連続変数の標準化パラメータ
  const C = contNames.length;
  const mu = Array(C).fill(0), sd = Array(C).fill(0);
  rows.forEach((r) => cont(r).forEach((v, i) => (mu[i] += v / rows.length)));
  rows.forEach((r) => cont(r).forEach((v, i) => (sd[i] += (v - mu[i]) ** 2 / rows.length)));
  sd.forEach((v, i) => (sd[i] = Math.sqrt(v) || 1));

  const stIdx = Object.fromEntries(stations.map((s, i) => [s, 1 + C + i]));
  const ctIdx = Object.fromEntries(cities.map((c, i) => [c, 1 + C + stations.length + i]));
  const dsIdx = Object.fromEntries(districts.map((d, i) => [d, 1 + C + stations.length + cities.length + i]));
  const P = 1 + C + stations.length + cities.length + districts.length;

  // 疎な特徴ベクトル [index, value][]
  const feats = (r) => {
    const f = [[0, 1]];
    cont(r).forEach((v, i) => f.push([1 + i, (v - mu[i]) / sd[i]]));
    if (stIdx[r.station] != null) f.push([stIdx[r.station], 1]);
    if (ctIdx[r.cityCode] != null) f.push([ctIdx[r.cityCode], 1]);
    if (dsIdx[dk(r)] != null) f.push([dsIdx[dk(r)], 1]);
    return f;
  };

  const A = Array.from({ length: P }, () => new Float64Array(P));
  const b = new Float64Array(P);
  for (const r of rows) {
    const f = feats(r), y = Math.log(r.tsuboPrice);
    for (const [i, vi] of f) {
      b[i] += vi * y;
      for (const [j, vj] of f) A[i][j] += vi * vj;
    }
  }
  const lambda = 3;
  for (let i = 1; i < P; i++) A[i][i] += lambda;
  const beta = solve(A, b);
  const cache = new Map();
  const predict = (r) => {
    const k = r.id + '|' + r.price;
    if (!cache.has(k)) cache.set(k, Math.exp(feats(r).reduce((s, [i, v]) => s + beta[i] * v, 0)));
    return cache.get(k);
  };

  // 当てはまりの目安（R²）
  const ys = rows.map((r) => Math.log(r.tsuboPrice));
  const ym = ys.reduce((s, v) => s + v, 0) / ys.length;
  const sst = ys.reduce((s, v) => s + (v - ym) ** 2, 0);
  const sse = rows.reduce((s, r, i) => s + (ys[i] - Math.log(predict(r))) ** 2, 0);
  return { predict, r2: 1 - sse / sst, stations: stations.length };
}

// ガウスの消去法（部分ピボット）
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => { const r = Array.from(row); r.push(b[i]); return r; });
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / d;
      if (!k) continue;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

// ---------- 注意フラグ ----------
function riskFlags(x) {
  const text = [x.name, x.title, x.detail?.remarks, x.detail?.landRight].join(' ');
  const flags = [];
  const hard = [];
  if (x.builtYM && x.builtYM < '1981-06') hard.push('旧耐震');
  else if (x.builtYM && x.builtYM < '1984-01') flags.push('耐震基準の境目');
  if (/定期借地|定借|借地権|地上権/.test(text)) hard.push('借地権');
  if (/告知事項|心理的|事故/.test(text)) hard.push('告知事項');
  if (/オーナーチェンジ|賃貸中|入居者付/.test(text)) hard.push('賃貸中');
  if (x.area < JUDGE.minAreaForModel) hard.push('投資用ワンルーム');
  if (x.bus) flags.push('バス便');
  if (x.builtYMRaw) flags.push(`築年月を補正(掲載は${x.builtYMRaw.replace('-', '年')}月)`);
  const d = x.detail;
  if (d) {
    const fee = (d.mgmtFee || 0) + (d.repairFee || 0);
    if (fee && fee / x.area > JUDGE.highFeePerSqm) flags.push(`管理費等高め(${Math.round(fee / x.area)}円/㎡)`);
    if (d.floor === 1) flags.push('1階');
    if (d.direction && /北/.test(d.direction) && !/南/.test(d.direction)) flags.push('北向き');
  }
  return { hard, flags };
}

// 業者の入力ミスで築年月が違う掲載がある（例: 1974年築が1件だけ2010年築）。
// 同じ住所(丁目)・同じ面積の掲載で築年月が割れていたら多数決で揃える（同数なら古い方＝割安と出にくい側）。
function fixBuiltYM(all) {
  const g = {};
  for (const x of all) (g[addrKey(x.address) + '|' + x.area] ||= []).push(x);
  for (const xs of Object.values(g)) {
    const cnt = {};
    xs.forEach((x) => x.builtYM && (cnt[x.builtYM] = (cnt[x.builtYM] || 0) + 1));
    const keys = Object.keys(cnt);
    if (keys.length < 2) continue;
    const mode = keys.sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b))[0];
    xs.forEach((x) => { if (x.builtYM !== mode) { x.builtYMRaw = x.builtYM; x.builtYM = mode; } });
  }
}

export function analyze(db, transactions, today) {
  const now = Date.parse(today);
  const all = Object.values(db).map((x) => ({ ...x }));
  fixBuiltYM(all);
  all.forEach((x) => { x.age = ageOf(x.builtYM, now); x.uk = unitKey(x); });
  // 初回実行日は全件が「新着」になってしまうので新着扱いしない
  const firstRunDay = all.reduce((m, x) => (x.firstSeen < m ? x.firstSeen : m), today);

  // 本日掲載中の物件（重複掲載は最安の1件にまとめる）
  const groups = {};
  for (const x of all.filter((x) => x.lastSeen === today)) {
    const k = dupKey(x);
    (groups[k] ||= []).push(x);
  }
  const active = Object.values(groups).map((g) => {
    g.sort((a, b) => a.price - b.price || a.firstSeen.localeCompare(b.firstSeen));
    return { ...g[0], dupCount: g.length, firstSeen: g.map((y) => y.firstSeen).sort()[0] };
  });

  const train = active.filter((x) => x.age != null && x.area >= JUDGE.minAreaForModel);
  const model = fitModel(train);

  // 同じ建物の事例（過去2年の掲載含む、重複キーで1件化）
  const byBuilding = {};
  for (const x of all) {
    const k = buildingKey(x);
    if (!k) continue;
    ((byBuilding[k] ||= {})[x.uk] = x);
  }

  // 近似物件探索用の索引
  const byStation = {}, byCity = {};
  for (const y of active) { (byStation[y.station] ||= []).push(y); (byCity[y.cityCode] ||= []).push(y); }

  const seiyaku = transactions.filter((t) => t.kind === '成約');
  const torihiki = transactions.filter((t) => t.kind === '取引');
  const thisYear = new Date(now).getFullYear();

  const pick = (pool, x, sameDistrict) => {
    const builtYear = x.builtYM ? Number(x.builtYM.slice(0, 4)) : null;
    return pool.filter((t) =>
      t.cityCode === x.cityCode && (!sameDistrict || t.district === x.district) &&
      t.builtYear && builtYear && Math.abs(t.builtYear - builtYear) <= JUDGE.peerAgeRange &&
      Math.abs(t.area / x.area - 1) <= JUDGE.peerAreaRatio);
  };

  const results = active.map((x) => {
    const r = { ...x };
    // model
    const px = x.age != null ? model.predict(x) : null;
    if (px) r.modelPrice = round(px, 1);
    // 比較対象の坪単価を、駅・徒歩・築年・面積の差だけ補正してから比べる
    const adj = (y) => (px && y.age != null ? y.tsuboPrice * px / model.predict(y) : y.tsuboPrice);
    // peer（同じ駅 → 同じ区）
    const like = (y) => y.uk !== x.uk && y.age != null && x.age != null &&
      Math.abs(y.age - x.age) <= JUDGE.peerAgeRange && Math.abs(y.area / x.area - 1) <= JUDGE.peerAreaRatio;
    let peers = (byStation[x.station] || []).filter((y) => like(y) && (x.walk == null || y.walk == null || Math.abs(y.walk - x.walk) <= JUDGE.peerWalkRange));
    r.peerScope = '同駅';
    if (peers.length < JUDGE.minPeers) { peers = (byCity[x.cityCode] || []).filter(like); r.peerScope = '同区市'; }
    if (peers.length >= JUDGE.minPeers) { r.peerPrice = round(median(peers.map(adj)), 1); r.peerN = peers.length; }
    // building
    const bk = buildingKey(x);
    const same = bk ? Object.values(byBuilding[bk] || {}).filter((y) => y.uk !== x.uk) : [];
    if (same.length >= 1) {
      r.buildingPrice = round(median(same.map(adj)), 1);
      r.buildingN = same.length;
    }
    // seiyaku（成約 → 不足なら取引価格も足す）
    let ts = pick(seiyaku, x, true); r.seiyakuScope = '同町・成約';
    if (ts.length < JUDGE.minPeers) { ts = pick(seiyaku, x, false); r.seiyakuScope = '同区市・成約'; }
    if (ts.length < JUDGE.minPeers) { ts = [...ts, ...pick(torihiki, x, false)]; r.seiyakuScope = '同区市・成約+取引'; }
    if (ts.length >= JUDGE.minPeers) { r.seiyakuPrice = round(median(ts.map((t) => t.tsuboPrice)), 1); r.seiyakuN = ts.length; }

    r.devModel = round(dev(x.tsuboPrice, r.modelPrice), 3);
    r.devPeer = round(dev(x.tsuboPrice, r.peerPrice), 3);
    r.devBuilding = round(dev(x.tsuboPrice, r.buildingPrice), 3);
    r.devSeiyaku = round(dev(x.tsuboPrice, r.seiyakuPrice), 3);
    const devs = [r.devModel, r.devPeer, r.devBuilding, r.devSeiyaku].filter((v) => v != null);
    r.signals = devs.filter((v) => v <= JUDGE.threshold).length;
    r.score = devs.length ? round(median(devs), 3) : null; // 総合割安率（各物差しの中央値）
    r.rating = r.signals >= JUDGE.starSignals && r.score <= JUDGE.starScore ? '★割安'
      : r.signals >= 1 && r.score <= JUDGE.checkScore ? '要確認' : '';

    // 値下げ
    const p = x.prices || [];
    if (p.length >= 2) {
      const [d1, cur] = p[p.length - 1], [, prev] = p[p.length - 2];
      if (cur < prev) Object.assign(r, { dropAmount: prev - cur, dropPct: round(cur / prev - 1, 3), dropDate: d1, prevPrice: prev });
    }
    r.daysListed = Math.round((now - Date.parse(r.firstSeen)) / 864e5);
    r.isNew = r.firstSeen === today && today !== firstRunDay;
    r.age = round(x.age, 1);
    Object.assign(r, riskFlags(r));
    delete r.prices; delete r.uk;
    return r;
  });

  return { results, model: { r2: round(model.r2, 3), n: train.length, stations: model.stations }, thisYear };
}

// 区市別の相場サマリ
export function areaStats(results, transactions) {
  const by = {};
  for (const x of results) {
    if (x.area < JUDGE.minAreaForModel) continue;
    (by[x.city] ||= { city: x.city, cityCode: x.cityCode, list: [], seiyaku: [] }).list.push(x.tsuboPrice);
  }
  for (const t of transactions) {
    const g = Object.values(by).find((g) => g.cityCode === t.cityCode);
    if (g && t.kind === '成約') g.seiyaku.push(t.tsuboPrice);
  }
  return Object.values(by).map((g) => ({
    city: g.city, n: g.list.length, listingMedian: round(median(g.list), 1),
    seiyakuN: g.seiyaku.length, seiyakuMedian: round(median(g.seiyaku), 1),
  })).sort((a, b) => b.listingMedian - a.listingMedian);
}
