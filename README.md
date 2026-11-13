# Laser STG

横スクロール型の2Dシューティングゲーム。貫通ロングレーザーと、自機の軌跡を追従する最大4機のオプションが特徴です。
HTML5 Canvas と Web Audio で動作し、外部の画像・音声アセットは使っていません。

Google のワークショップで作成しました。
制作の記録は [WORKSHOP.md](WORKSHOP.md) にあります。

## 遊ぶ

ブラウザで開くだけで遊べます: **https://hdeep04.github.io/laser-stg/**

### ローカルで動かす場合

`index.html` をブラウザで開くだけで動きます。Node.js 18 以上が入っていれば、次でも起動できます。

```bash
npm start
```

起動後、http://localhost:8080 を開きます。

## 操作

| 操作 | キー |
| :--- | :--- |
| 移動 | 矢印キー / WASD |
| ショット(押しっぱなしで連射) | Z / Space / J |
| パワーアップ発動 | X / Shift / K / Enter |
| ポーズ | P / Esc |

## テスト

```bash
npm test
```

## 構成

- `index.html` / `style.css` : 画面
- `src/` : ゲーム本体(自機・敵・武器・当たり判定・描画・サウンドなど)
- `server.js` : 静的ファイル配信サーバー(Cloud Run 対応)
- `tests/verify-spec.js` : 仕様検証テスト
- `gradius-laser-stg-spec.md` : 開発仕様書
