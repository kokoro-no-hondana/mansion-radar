// Webアプリ用JSONとExcelファイルを docs/data に書き出す。
import fs from 'node:fs';
import ExcelJS from 'exceljs';

const DIR = 'docs/data';

const isDeal = (x) => !!x.rating;
const isDrop = (x) => x.dropAmount && x.dropDate;

// Web用に必要な項目だけに絞る
const slim = (x) => {
  const keys = ['id', 'url', 'name', 'price', 'area', 'tsubo', 'tsuboPrice', 'layout', 'builtYM', 'age', 'city', 'district',
    'station', 'lineName', 'walk', 'bus', 'modelPrice', 'peerPrice', 'peerN', 'peerScope', 'buildingPrice', 'buildingN',
    'seiyakuPrice', 'seiyakuN', 'seiyakuScope', 'devModel', 'devPeer', 'devBuilding', 'devSeiyaku', 'signals', 'score',
    'rating', 'dropAmount', 'dropPct', 'dropDate', 'prevPrice', 'firstSeen', 'daysListed', 'isNew', 'hard', 'flags', 'dupCount'];
  const o = {};
  for (const k of keys) if (x[k] != null && x[k] !== '' && !(Array.isArray(x[k]) && !x[k].length)) o[k] = x[k];
  if (x.detail) Object.assign(o, { mgmtFee: x.detail.mgmtFee, repairFee: x.detail.repairFee, floor: x.detail.floor, direction: x.detail.direction, totalUnits: x.detail.totalUnits });
  return o;
};

export async function writeOutputs({ results, model, stats, today, updatedAt, txCount }) {
  fs.mkdirSync(DIR, { recursive: true });
  const all = results.map(slim);
  const summary = {
    today, updatedAt, model, txCount,
    counts: {
      active: all.length,
      new: all.filter((x) => x.isNew).length,
      star: all.filter((x) => x.rating === '★割安').length,
      check: all.filter((x) => x.rating === '要確認').length,
      drop: all.filter((x) => isDrop(x) && x.dropDate === today).length,
    },
    stats,
    deals: all.filter((x) => isDeal(x) || (isDrop(x) && x.dropDate >= daysAgo(today, 7))),
  };
  fs.writeFileSync(`${DIR}/summary.json`, JSON.stringify(summary));
  fs.writeFileSync(`${DIR}/all.json`, JSON.stringify(all));
  await writeExcel(all, summary);
}

const daysAgo = (d, n) => new Date(Date.parse(d) - n * 864e5).toISOString().slice(0, 10);
const pct = (v) => (v == null ? null : v);

async function writeExcel(all, summary) {
  const wb = new ExcelJS.Workbook();
  const cols = [
    ['判定', 'rating', 9], ['総合割安率', 'score', 11, '0.0%'], ['シグナル数', 'signals', 9],
    ['物件名', 'name', 34], ['価格(万円)', 'price', 10, '#,##0'], ['坪単価(万円)', 'tsuboPrice', 11, '0.0'],
    ['専有㎡', 'area', 8, '0.00'], ['坪', 'tsubo', 7, '0.00'], ['間取り', 'layout', 8], ['築年月', 'builtYM', 9], ['築年数', 'age', 7, '0.0'],
    ['区市', 'city', 13], ['町名', 'district', 12], ['駅', 'station', 10], ['徒歩(分)', 'walk', 8],
    ['理論坪単価', 'modelPrice', 10, '0.0'], ['理論比', 'devModel', 8, '0.0%'],
    ['近似物件中央値', 'peerPrice', 11, '0.0'], ['近似比', 'devPeer', 8, '0.0%'], ['近似件数', 'peerN', 8],
    ['同建物中央値', 'buildingPrice', 11, '0.0'], ['同建物比', 'devBuilding', 8, '0.0%'], ['同建物件数', 'buildingN', 8],
    ['成約中央値', 'seiyakuPrice', 10, '0.0'], ['成約比', 'devSeiyaku', 8, '0.0%'], ['成約件数', 'seiyakuN', 8],
    ['値下げ額', 'dropAmount', 8], ['値下げ日', 'dropDate', 10], ['初掲載日', 'firstSeen', 10],
    ['管理費', 'mgmtFee', 8], ['修繕積立金', 'repairFee', 9], ['所在階', 'floor', 6], ['向き', 'direction', 6],
    ['注意(重)', 'hardText', 18], ['注意', 'flagText', 18], ['URL', 'url', 40],
  ];
  const addSheet = (name, rows) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 4 }] });
    ws.columns = cols.map(([header, key, width, numFmt]) => ({ header, key, width, style: numFmt ? { numFmt } : {} }));
    rows.forEach((x) => ws.addRow({ ...x, score: pct(x.score), hardText: (x.hard || []).join('・'), flagText: (x.flags || []).join('・') }));
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
    ws.getColumn('url').eachCell((c, i) => { if (i > 1 && c.value) c.value = { text: '開く', hyperlink: c.value }; });
  };
  const byScore = (a, b) => (a.score ?? 9) - (b.score ?? 9);
  addSheet('本日の割安', all.filter(isDeal).sort(byScore));
  addSheet('値下げ', all.filter(isDrop).sort((a, b) => b.dropDate.localeCompare(a.dropDate) || a.dropPct - b.dropPct));
  addSheet('全物件', [...all].sort(byScore));
  const ws = wb.addWorksheet('エリア相場');
  ws.columns = [
    { header: '区市', key: 'city', width: 14 }, { header: '掲載件数', key: 'n', width: 9 },
    { header: '掲載 坪単価中央値(万円)', key: 'listingMedian', width: 20 },
    { header: '成約件数', key: 'seiyakuN', width: 9 }, { header: '成約 坪単価中央値(万円)', key: 'seiyakuMedian', width: 20 },
  ];
  summary.stats.forEach((s) => ws.addRow(s));
  ws.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(`${DIR}/mansion_radar.xlsx`);
}
