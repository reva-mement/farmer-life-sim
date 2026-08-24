# 箱庭農民記 (Farmer Life Sim)

江戸期の農村を舞台にした箱庭系の農民生活シミュレーター。Vite + React + Three.js で開発する。

## セットアップ

```bash
npm install
npm run dev
```

## スクリーンショット検証ループ

開発サーバーを起動し、ヘッドレスChromiumでページを開いてスクリーンショットを保存する。
画面を直接確認できない場合の検証手段として使う。

```bash
npm run screenshot
# -> screenshots/latest.png に保存される
```

## ディレクトリ構成

- `src/` — 本実装(現在はレンダリング/スクリーンショットパイプライン検証用のプレースホルダーシーンのみ)
- `reference/` — claude.aiアーティファクト環境で作った参考実装群(そのまま使うのではなく、リファクタリングしながら本実装に統合していく)
- `farmer-sim-design-doc-v2.md` — 開発方針・踏んだバグの記録・確立した技術方式をまとめた引き継ぎドキュメント。開発を始める前に必ず読むこと
- `scripts/screenshot.mjs` — スクリーンショット検証ループの実装
