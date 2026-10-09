<p align="center">
  <img src="packages/app/assets/images/osuna-logo.png" width="64" height="64" alt="Osuna ロゴ">
</p>

<h1 align="center">Osuna</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/LFT-OXY/Osuna/releases">
    <img src="https://img.shields.io/github/v/release/LFT-OXY/Osuna?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode、Pi のエージェントを、ひとつのインターフェースで。</p>

自分のマシンでエージェントを並列実行。スマートフォンからでもデスクからでも、開発を進めてリリースできます。

- **セルフホスト:** エージェントはあなたのマシン上で動作し、完全な開発環境を使用します。自分のツール・設定・スキルをそのまま活用できます。
- **マルチプロバイダー:** Claude Code、Codex、Copilot、OpenCode、Pi を同一のインターフェースで利用。タスクに合ったモデルを選べます。
- **音声コントロール:** 音声モードでタスクを口述したり問題を話し合ったりできます。ハンズフリーが必要なときに便利です。
- **クロスデバイス:** デスクトップ、Web、CLI、スマートフォンに対応。机で作業を始め、スマートフォンで確認し、ターミナルから自動化できます。
- **プライバシー優先:** Osuna にはテレメトリー・トラッキング・強制ログインは一切ありません。

## プラグイン

信頼できる TypeScript プラグインで、テーマ、ワークスペースパネル、コマンド、設定画面、コーディングエージェントのプロバイダーを追加できます。
`osuna plugin add <source>` でローカルディレクトリまたは Git リポジトリからインストールします。

詳しくは[プラグインのドキュメント](docs/plugins.md)を参照してください。プラグインはデーモンが動くマシンにアクセスでき、接続中のクライアント内でも実行されます。信頼できるコードだけをインストールしてください。

## はじめかた

Osuna はコーディングエージェントを管理するローカルサーバー（デーモン）を起動します。デスクトップアプリ・Web アプリ・CLI・モバイルアプリなどのクライアントがこのデーモンに接続します。

### 前提条件

エージェント CLI をひとつ以上インストールし、認証情報を設定しておく必要があります。

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### デスクトップアプリ（推奨）

[GitHub のリリースページ](https://github.com/LFT-OXY/Osuna/releases)からダウンロードしてください。アプリを開くとデーモンが自動的に起動します。追加のインストールは不要です。

スマートフォンから接続するには、**Settings → ホスト → Pair Device** を開いて QR コードを読み取ってください。リンクから Osuna の Web アプリが開きます。Android ではリリースページの APK もインストールできます。上流の Paseo モバイルアプリはサポート対象のクライアントではありません。

ターミナルで `osuna` コマンドを使うには、**Settings → Integrations → Command line** を開き、**Install** をクリックします。コマンドが `~/.local/bin` にリンクされます。

### Docker

Osuna デーモンとセルフホスト Web UI を Docker で実行します。サーバーやリモートマシンでの利用に適しています。

```bash
docker run -d --name osuna \
  -p 6767:6767 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/osuna-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

起動したら `http://localhost:6767` を開いてください。使用するエージェント CLI をベースイメージに追加し、環境変数または永続化した `/home/osuna` ボリュームで認証情報を渡します。詳しくは [Docker のドキュメント](docs/docker.md)を参照してください。

### ソースからビルド

Docker を使わないサーバーやヘッドレスマシンでは、このリポジトリからデーモンと CLI をビルドします。Node.js のバージョンは `.tool-versions` を参照してください。

```bash
git clone https://github.com/LFT-OXY/Osuna.git
cd Osuna
npm ci
npm run build:server
node packages/cli/bin/osuna
```

最後のコマンドはデーモンを起動し、ペアリング用の QR コードを表示するかどうかを尋ねます。その他のコマンドは `node packages/cli/bin/osuna --help` で確認できます。

npm から `@getpaseo/cli` をインストールしないでください。それは上流の Paseo で、Osuna ではありません。

## CLI の使い方

アプリでできることはすべてターミナルからも実行できます。

```bash
osuna run --provider claude/opus-4.6 "implement user authentication"
osuna run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

osuna ls                           # 実行中のエージェントを一覧表示
osuna attach abc123                # ライブ出力をストリーミング
osuna send abc123 "also add tests" # 追加タスクを送信

# リモートデーモンで実行。--cwd はそのホスト上のパス
osuna run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

コマンドの一覧は `osuna --help` で確認できます。

## スキル

スキルはエージェントに Osuna を使って他のエージェントをオーケストレーションする方法を教えます。

```bash
npx skills add LFT-OXY/Osuna
```

どのエージェントとの会話でも使用できます。

- `/osuna-handoff` — エージェント間で作業を引き継ぎます。私はこれを使って Claude で計画し、Codex に実装を引き継いでいます。
- `/osuna-advisor` — 単一のエージェントをアドバイザーとして起動し、作業を委任せずにセカンドオピニオンを得ます。
- `/osuna-committee` — 対照的な2つのエージェントで委員会を構成し、一歩引いた視点で根本原因を分析して計画を作成します。

## 開発

モノレポのパッケージ構成：

- `packages/server`: Osuna デーモン（エージェントプロセスのオーケストレーション、WebSocket API、MCP サーバー）
- `packages/app`: Expo クライアント（iOS、Android、Web）
- `packages/cli`: デーモンおよびエージェントワークフロー向け `osuna` CLI
- `packages/desktop`: Electron デスクトップアプリ
- `packages/relay`: デーモンとクライアントが使うリレーの通信と暗号化
- `packages/website`: 公式サイトと公開ドキュメント（`osuna.chinhae.cc`）

よく使うコマンド：

```bash
# すべてのローカル開発サービスを起動
npm run dev

# 個別のサービスを起動
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# サーバースタックをビルド
npm run build:server

# リポジトリ全体のチェック
npm run typecheck
```

開発環境の詳しいセットアップは [docs/development.md](docs/development.md) を参照してください。

## ライセンス

Apache-2.0

Osuna は [Paseo](https://github.com/getpaseo/paseo) のフォークとして始まり、現在は独立して開発されています。[NOTICE](NOTICE) を参照してください。
