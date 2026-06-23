# plugins/ — Mini Plugin System

## Scopo

Ogni file `.js` in questa directory è un **plugin** per `mini`.
I plugin vengono caricati automaticamente all'avvio di `mini` senza richiedere modifiche al codice principale.

---

## Interfaccia plugin

```js
module.exports = {
  name: 'plugin-name',          // nome canonico (usato in usage output)
  commands: ['cmd1', 'cmd2'],   // comandi che attivano questo plugin
  describe: 'Descrizione breve',
  async run(args, context) {
    // args    = process.argv.slice(3) (es. ['DEMO-123'])
    // context = { http, shell, config, prompt, format, fs, path, develRoot }
    //           tutto l'I/O passa da qui → testabile con i fake in tests/helpers/
  }
};
```

Il `context` (costruito in `lib/plugin-context.js`, faked in `tests/helpers/`):

| Servizio | Forma | Uso |
|---|---|---|
| `context.http` | `request(method, url, opts)` | HTTP (fake nei test) |
| `context.shell` | `run(...)`, `capture(...)` | sottoprocessi (fake nei test) |
| `context.config` | `read(keys, dotfile, defaults)` | legge `~/.<tool>` + env + default |
| `context.prompt` | `yesNo`, `input`, `choice` | prompt interattivi |
| `context.format` | `table(headers, rows)` | tabelle ASCII |
| `context.fs` · `context.path` · `context.develRoot` | built-in + root repo | filesystem |

**Mai** usare `require('https')`/`child_process` direttamente: passa sempre da `context` (è ciò che rende i plugin testabili offline).

Regole:
- `commands` è un array di stringhe — tutti gli alias devono essere in questa lista.
- `run` può essere `async` o sincrona.
- Se `run` lancia un errore, `mini` lo cattura e stampa `e.message`.
- I file che iniziano con `_` sono ignorati (usali per utility condivise tra plugin).

---

## Plugin disponibili

| File | Comandi | Descrizione |
|------|---------|-------------|
| `yt.js` | `youtrack`, `yt` | YouTrack ticket management |
| `cdk.js` | `cdk`, `webapp` | Deploy webapp statiche su AWS (CDK + CloudFront + S3) |

---

## Aggiungere un nuovo plugin

1. Crea `plugins/nuovo-plugin.js` con l'interfaccia sopra.
2. Il plugin viene caricato automaticamente al prossimo avvio di `mini`.
3. Aggiungi la riga alla tabella sopra.
4. Aggiorna `usage()` in `bin/mini` se vuoi che appaia nell'help.

---

## Credenziali e config

- **YouTrack**: `~/.youtrack` (`YT_TOKEN`, `YT_BASE`, e i default operativi: board, colonne, progetto, priorità). Env var hanno precedenza.
- **CDK**: `config/cdk.json` (gitignored) — profili AWS e bundle. Template: `config/cdk.example.json`.

**Non hardcodare** token, account, host, domini o valori d'ambiente nei plugin: solo placeholder generici nel codice, valori reali fuori dal repo. Se un valore richiesto manca, fallire in modo esplicito.
