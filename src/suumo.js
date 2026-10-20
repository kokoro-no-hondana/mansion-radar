// SUUMO 中古マンションの一覧・詳細ページを取得して物件データに変換する。
import * as cheerio from 'cheerio';
import { SCRAPE, CITIES, TSUBO_PER_SQM } from './config.js';
import { sleep, parseManYen, parseYen, norm } from './util.js';

const BASE = 'https://suumo.jp';

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': SCRAPE.userAgent, 'Accept-Language': 'ja' }, redirect: 'follow' });
      if (res.status === 200) return await res.text();
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(SCRAPE.delayMs * 3 * i);
    }
  }
}

const listUrl = (sc, page) =>
  `${BASE}/jj/bukken/ichiran/JJ012FC001/?ar=060&bs=011&ta=27&sc=${sc}&pc=100&page=${page}`;

// "ＪＲ東海道本線「高槻」徒歩13分" / "阪急京都線「富田」バス10分停歩3分"
function parseAccess(s) {
  const t = norm(s);
  const m = t.match(/^(.*?)「(.+?)」(.*)$/);
  if (!m) return { line: t, station: null, walk: null, bus: false };
  const rest = m[3];
  const walk = rest.match(/徒歩(\d+)分/);
  const bus = rest.match(/バス(\d+)分(?:停歩(\d+)分)?/);
  return {
    line: m[1],
    station: m[2],
    // バス便は「徒歩換算」として バス分×1.5 + 停歩 を使う
    walk: walk ? Number(walk[1]) : bus ? Math.round(Number(bus[1]) * 1.5 + Number(bus[2] || 0)) : null,
    bus: !!bus && !walk,
  };
}

function parseUnit($, el, cityCode) {
  const $el = $(el);
  const href = $el.find('h2.property_unit-title a').attr('href') || '';
  const id = (href.match(/nc_(\d+)/) || [])[1];
  if (!id) return null;
  const f = {};
  $el.find('.dottable dl').each((_, dl) => {
    f[$(dl).find('dt').first().text().trim()] = $(dl).find('dd').first().text().replace(/\s+/g, ' ').trim();
  });
  const price = parseManYen(f['販売価格']);
  const area = Number((f['専有面積'] || '').match(/([\d.]+)m/)?.[1]);
  if (!price || !area) return null;
  const built = (f['築年月'] || '').match(/(\d{4})年(\d{1,2})月/);
  const address = norm(f['所在地']).replace(/^大阪府/, '');
  const city = CITIES[cityCode];
  const acc = parseAccess(f['沿線・駅'] || '');
  return {
    id,
    url: BASE + href,
    name: f['物件名'],
    title: $el.find('h2.property_unit-title a').text().trim(),
    price,                                   // 万円
    area,                                    // ㎡
    tsubo: Math.round(area * TSUBO_PER_SQM * 100) / 100,
    tsuboPrice: Math.round((price / (area * TSUBO_PER_SQM)) * 10) / 10, // 万円/坪
    layout: norm(f['間取り']),
    balcony: Number((f['バルコニー'] || '').match(/([\d.]+)m/)?.[1]) || null,
    builtYM: built ? `${built[1]}-${built[2].padStart(2, '0')}` : null,
    cityCode: String(cityCode),
    city,
    district: address.replace(city, '').replace(/[0-9-].*$/, ''),
    address,
    lineName: acc.line,
    station: acc.station,
    walk: acc.walk,
    bus: acc.bus,
  };
}

export async function scrapeCity(cityCode, log = console.log) {
  const out = [];
  for (let page = 1; page <= SCRAPE.maxPagesPerCity; page++) {
    const html = await get(listUrl(cityCode, page));
    if (!html) break;
    const $ = cheerio.load(html);
    const units = $('.property_unit').toArray();
    units.forEach((el) => {
      const u = parseUnit($, el, cityCode);
      if (u) out.push(u);
    });
    const hasNext = $('.pagination-parts a').toArray().some((a) => $(a).text().trim() === '次へ');
    if (page === 1) log(`  ${CITIES[cityCode]}: ${$('.pagination_set-hit').first().text().replace(/\s/g, '')}`);
    await sleep(SCRAPE.delayMs);
    if (!units.length || !hasNext) break;
  }
  return out;
}

export async function scrapeAll(log = console.log) {
  const all = [];
  for (const code of Object.keys(CITIES)) {
    all.push(...(await scrapeCity(code, log)));
  }
  return all;
}

// 詳細（物件概要）ページ：管理費・修繕積立金・所在階・向き・総戸数・構造・権利形態など
export async function scrapeDetail(url) {
  const html = await get(url.replace(/\/?$/, '/') + 'bukkengaiyo/');
  if (!html) return null;
  const $ = cheerio.load(html);
  const f = {};
  $('th').each((_, th) => {
    const key = $(th).find('div.fl').first().text().trim() || $(th).text().trim();
    const td = $(th).next('td');
    if (key && td.length && !(key in f)) f[key] = td.text().replace(/\s+/g, ' ').trim();
  });
  const mgmt = parseYen(f['管理費']);
  const repair = parseYen(f['修繕積立金']);
  return {
    mgmtFee: mgmt,
    repairFee: repair,
    floor: Number((f['所在階'] || '').match(/(\d+)階/)?.[1]) || null,
    direction: f['向き'] || null,
    totalUnits: Number((f['総戸数'] || '').match(/(\d+)戸/)?.[1]) || null,
    structure: f['構造・階建て'] || null,
    landRight: f['敷地の権利形態'] || null,
    remarks: [f['その他制限事項'], f['その他概要・特記事項'], f['備考']].filter((x) => x && x !== '-').join(' / ') || null,
  };
}
