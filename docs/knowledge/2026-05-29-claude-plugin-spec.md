# Claude Code Plugin / Marketplace — 実用テンプレ

kawaz/* で 1 plugin 配布する時の 2 manifest 最小テンプレ + README install 手順 + 参考 URL ポインタ。詳細 spec は出典先参照。

## plugin.json (`.claude-plugin/plugin.json`)

```json
{
  "name": "<plugin-name>",
  "description": "<short description>",
  "version": "<semver>",
  "author": { "name": "kawaz" },
  "license": "MIT",
  "repository": "https://github.com/kawaz/<repo>"
}
```

触るのは `name` / `description` / `version` / `repository` の 4 field。残り固定。

## marketplace.json (`.claude-plugin/marketplace.json`)

```json
{
  "name": "<plugin-name>",
  "owner": { "name": "kawaz" },
  "metadata": {
    "description": "<short description>",
    "version": "<semver>",
    "license": "MIT"
  },
  "plugins": [
    {
      "name": "<plugin-name>",
      "description": "<plugin description>",
      "source": "./"
    }
  ]
}
```

1 plugin 配布なら `source: "./"` 固定 (= marketplace.json 自身がいる plugin root を指す)。version は `just bump-version` で plugin.json と同期。

## README に書く install 手順 (2 コマンド)

```
claude plugin marketplace add kawaz/<repo>
claude plugin install <plugin-name>@<plugin-name>
```

cmux-msg の例:

```
claude plugin marketplace add kawaz/claude-cmux-msg
claude plugin install cmux-msg@cmux-msg
```

## 参考 URL (一次情報)

- [Claude Code Plugins](https://code.claude.com/docs/en/plugins.md)
- [Plugins Reference](https://code.claude.com/docs/en/plugins-reference.md)
- [Skills](https://code.claude.com/docs/en/skills.md)
- [Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces.md)
- [Discover and install plugins](https://code.claude.com/docs/en/discover-plugins.md)
- [Hooks Guide](https://code.claude.com/docs/en/hooks-guide.md)
