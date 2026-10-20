# 割安マンションレーダー

大阪市24区・高槻市の中古マンションを毎朝SUUMOから全件取得し、坪単価が割安な物件をスマホで確認できるようにする仕組み。

## 毎朝の流れ（GitHub Actions・7:30 JST開始、8時前後に更新完了）

1. SUUMO 一覧ページを全件取得（3秒間隔・約90ページ）→ `data/listings.json` に価格履歴つきで蓄積
2. 国交省 不動産情報ライブラリAPIから成約価格を取得（週1回更新）→ `data/transactions.json`
3. 割安判定（下記）→ 割安候補だけ詳細ページを取得して管理費・所在階・向き・権利形態を補完
4. `docs/data/` に Web用JSON と Excel を出力 → GitHub Pages で公開

## 割安判定

坪単価（価格 ÷ 専有面積×0.3025）を4つの物差しと比較する。

| 物差し | 中身 |
|---|---|
| 理論値 | 駅・区・町名・築年・面積・徒歩から推定した坪単価（リッジ回帰） |
| 近似物件 | 同じ駅（足りなければ同じ区）・築年±5年・面積±20%の掲載物件の中央値（条件差は理論値で補正） |
| 同じ建物 | 所在地＋築年月が同じ他住戸（過去2年の掲載含む）の中央値 |
| 成約事例 | 不動産情報ライブラリの成約価格（同じ町→同じ区、築年±5年・面積±20%） |

- −15%以下の物差しが2つ以上、かつ総合割安率（4つの中央値）−25%以下 → **★割安**
- 1つ以上、かつ −15%以下 → **要確認**
- 旧耐震・借地権・賃貸中・告知事項・投資用ワンルームは「訳あり候補」として別表示

基準値は `src/config.js` の `JUDGE` で調整できる。

## 手元での実行

```bash
npm install
node src/main.js               # 全件取得（10〜15分）
node src/main.js --city=27207  # 高槻市だけ（動作確認）
node src/main.js --skip-scrape # 取得せず判定だけやり直す
```

成約データを使う場合は環境変数 `REINFOLIB_API_KEY` にAPIキーを設定する。

## GitHub の設定

1. リポジトリの Settings → Secrets and variables → Actions → `REINFOLIB_API_KEY` を登録
2. Settings → Pages → Source: `Deploy from a branch`、Branch: `main` / `/docs`
3. Actions タブ → `daily-scan` → `Run workflow` で初回実行
