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
    // args   = process.argv.slice(3) (es. ['DEMO-123'])
    // context = { DEVEL_ROOT, path, fs }
  }
};
```

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
| `bitbucket.js` | `bitbucket`, `bb` | Bitbucket repo management |

---

## Aggiungere un nuovo plugin

1. Crea `plugins/nuovo-plugin.js` con l'interfaccia sopra.
2. Il plugin viene caricato automaticamente al prossimo avvio di `mini`.
3. Aggiungi la riga alla tabella sopra.
4. Aggiorna `usage()` in `bin/mini` se vuoi che appaia nell'help.

---

## Credenziali e config

- **YouTrack**: `YT_TOKEN` env var, oppure `~/.youtrack` (formato: `YT_TOKEN=<token>`)
- **Bitbucket**: `~/.bitbucket` (formato: `BITBUCKET_TOKEN=<token>` o `BITBUCKET_USERNAME=` + `BITBUCKET_APP_PASSWORD=`)

Non hardcodare token nei plugin.
