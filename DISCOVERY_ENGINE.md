# Pokeca Life Discovery Engine

## 目的

Pokeca Lifeは、ユーザーが抽選情報を登録するサービスではない。アプリ側が公式サイト、公式X、店舗サイト、店舗アプリ、Googleフォーム、LivePocketなどを巡回し、抽選情報を自動で発見・解析・統合・公開・通知する。

## 一気通貫フロー

1. **Source Database** — 全国の情報源と店舗別ルールを非公開設定として管理する。
2. **Crawler** — 優先度と巡回間隔を持って各情報源を取得する。
3. **Discovery** — 一覧ページ、埋め込みJSON、リンクから候補ページを発見する。
4. **Newness Detection** — ページ本文の意味的fingerprintで初出・更新・既知を区別する。
5. **Parser / OCR** — 店舗、商品、応募期間、結果発表、購入期限、応募先を構造化する。
6. **URL / Identity Merge** — 追跡パラメータや表記差を正規化し、同一抽選を統合する。
7. **Quality Gate** — 商品カタログ、日付整合、直接応募先、公式告知を検証する。
8. **Publish / Review** — 合格データだけを公開し、不確実な候補は非公開確認キューへ送る。
9. **Notification** — 新着・締切・結果・購入期限の通知対象を生成する。

## v1.24.0で実装した基盤

- 旧形式と互換性を保った情報源DB正規化
- 情報源ID、platform、公式区分、都道府県、優先度、巡回間隔の標準化
- 不正URL、重複ID、未登録parserの検査
- Workflow実行前の情報源DB検証
- ルートページの初出・更新検知
- 候補ページの新着・更新・既知判定
- UTMなど追跡パラメータを除外した候補URL同一判定
- URLや情報源名を保存しないハッシュ状態ファイル
- 180日候補・365日情報源の状態整理
- Collector StatusへのDiscovery Engine診断追加
- LivePocket未設定時に誤って劣化判定する既存不具合の修正

## Source Database v2

既存の `.private/sources.json` はそのまま利用できる。新しい項目は省略可能で、未指定時は安全な既定値が補完される。

```json
{
  "version": 2,
  "sources": [
    {
      "id": "stable-source-id",
      "name": "公式サイト名",
      "url": "https://example.com/news/",
      "enabled": true,
      "platform": "website",
      "officialStatus": "official",
      "prefecture": "全国",
      "priority": 90,
      "crawlIntervalMinutes": 15,
      "parser": "generic",
      "discovery": {
        "enabled": true,
        "childParser": "generic",
        "maxPages": 12
      }
    }
  ]
}
```

## 状態ファイルの安全性

`collector/state/discovery-state.json` に保存するのは次だけである。

- 情報源を一方向ハッシュ化したキー
- 候補URLを一方向ハッシュ化したキー
- 本文fingerprint
- 初回・最終確認・最終変更日時

元URL、情報源名、ページ本文、抽選内容は保存しない。公開ビルドにも含めない。

## 完成判定

Discovery Engineは、単体テストだけで完成とはしない。以下をすべて確認する。

- 情報源DB検証
- Parser単体テスト
- Discovery・新着検知テスト
- Collector結合テスト
- 公開領域の機密情報検査
- 実サイトでの取得成功率・候補発見率・解析成功率
- 既存抽選データの回帰確認
