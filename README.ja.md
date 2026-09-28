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

> [!NOTE]
> Osuna は [Paseo](https://github.com/getpaseo/paseo) のフォークです。内部の識別子は上流の表記のままです。CLI コマンドは `paseo`、データは `~/.paseo`、環境変数は `PASEO_` で始まります。

## プラグイン

信頼できる TypeScript プラグインで、テーマ、ワークスペースパネル、コマンド、設定画面、コーディングエージェントのプロバイダーを追加できます。
`paseo plugin add <source>` でローカルディレクトリまたは Git リポジトリからインストールします。

詳しくは[プラグインのドキュメント](docs/plugins.md)を参照してください。プラグインはデーモンが動くマシンにアクセスでき、接続中のクライアント内でも実行されます。信頼できるコードだけをインストールしてください。

## はじめかた

Osuna はコーディングエージェントを管理するローカルサーバー（デーモン）を起動します。デスクトップアプリ・Web アプリ・CLI・Paseo モバイルアプリなどのクライアントがこのデーモンに接続します。

### 前提条件

エージェント CLI をひとつ以上インストールし、認証情報を設定しておく必要があります。

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### デスクトップアプリ（推奨）

[GitHub のリリースページ](https://github.com/LFT-OXY/Osuna/releases)からダウンロードしてください。アプリを開くとデーモンが自動的に起動します。追加のインストールは不要です。

スマートフォンから接続するには、公式の Paseo モバイルアプリをインストールし、Osuna で **Settings → ホスト → Pair Device** を開いてください。

### CLI

デスクトップアプリで **Settings → Integrations → Command line** を開き、**Install** をクリックします。`paseo` コマンドが `~/.local/bin` にリンクされます。

npm から `@getpaseo/cli` をインストールしないでください。それは上流の Paseo で、Osuna ではありません。

### Docker

Osuna デーモンとセルフホスト Web UI を Docker で実行します。サーバーやリモートマシンでの利用に適しています。

```bash
docker run -d --name osuna \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/paseo-home:/home/paseo" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/paseo:latest
```

起動したら `http://localhost:6767` を開いてください。使用するエージェント CLI をベースイメージに追加し、環境変数または永続化した `/home/paseo` ボリュームで認証情報を渡します。詳しくは [Docker のドキュメント](docs/docker.md)を参照してください。

## CLI の使い方

アプリでできることはすべてターミナルからも実行できます。

```bash
paseo run --provider claude/opus-4.6 "implement user authentication"
paseo run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

paseo ls                           # 実行中のエージェントを一覧表示
paseo attach abc123                # ライブ出力をストリーミング
paseo send abc123 "also add tests" # 追加タスクを送信

# リモートデーモンで実行。--cwd はそのホスト上のパス
paseo run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

コマンドの一覧は `paseo --help` で確認できます。

## スキル

スキルはエージェントに Osuna を使って他のエージェントをオーケストレーションする方法を教えます。

```bash
npx skills add LFT-OXY/Osuna
```

どのエージェントとの会話でも使用できます。

- `/paseo-handoff` — エージェント間で作業を引き継ぎます。私はこれを使って Claude で計画し、Codex に実装を引き継いでいます。
- `/paseo-advisor` — 単一のエージェントをアドバイザーとして起動し、作業を委任せずにセカンドオピニオンを得ます。
- `/paseo-committee` — 対照的な2つのエージェントで委員会を構成し、一歩引いた視点で根本原因を分析して計画を作成します。

## 開発

モノレポのパッケージ構成：

- `packages/server`: Osuna デーモン（エージェントプロセスのオーケストレーション、WebSocket API、MCP サーバー）
- `packages/app`: Expo クライアント（iOS、Android、Web）
- `packages/cli`: デーモンおよびエージェントワークフロー向け `paseo` CLI
- `packages/desktop`: Electron デスクトップアプリ
- `packages/relay`: デーモンとクライアントが使うリレーの通信と暗号化
- `packages/website`: 上流のマーケティングサイトとドキュメント（`paseo.sh`）。このフォークではデプロイしません

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
