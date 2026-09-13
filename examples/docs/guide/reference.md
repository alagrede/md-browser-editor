# Reference

## Commands

| Command | What it does | Writes? |
| --- | --- | :---: |
| `serve` | sert l arbre et l editeur | no |
| `mentions` | lists the mentions for an agent | with `--resolve` |
| `mentions --json` | the same, machine-readable | no |
|   |   |   |
|   |   |   |

Click any cell to edit it, ＋ to add a row or a column.

## Highlighting

```js
const mentions = await collectMentions('./docs');
console.log(mentions.filter(mention => !mention.unterminated).length);
```

```sh
npx md-browser-editor mentions ./docs --json | jq '.mentions[].prompt'
```

```json
{ "file": "guide/page.md", "id": "a3f", "prompt": "Reformule ça" }
```

```yaml
serve:
  port: 4830
  host: 127.0.0.1
```
