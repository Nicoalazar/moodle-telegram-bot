# Moodle → Telegram: aviso de novedades del aula virtual

Chequea las materias indicadas en tu Moodle (`https://aulasvirtuales.bue.edu.ar`), detecta
qué es genuinamente nuevo desde la última corrida (contenido, tareas, vencimientos próximos)
y te manda un resumen por Telegram. Sin frameworks: Node.js 18+ con `fetch` nativo.

## Estructura

```
index.js                      orquestación completa (Fase 5)
src/env.js                    lee/escribe .env (sin dependencias externas)
src/moodleClient.js           cliente REST de Moodle (Fase 2)
src/state.js                  lectura/escritura de estado + cálculo de "qué es nuevo" (Fase 3)
src/telegram.js               armado del resumen + envío por Telegram (Fase 4)
scripts/get-moodle-token.mjs  setup interactivo: obtiene MOODLE_TOKEN (Fase 1)
scripts/get-telegram-chat-id.mjs  setup interactivo: obtiene TELEGRAM_CHAT_ID (Fase 1)
scripts/list-courses.mjs      utilidad: lista tus cursos con su ID (para armar MOODLE_COURSE_IDS)
data/state.json               estado persistido entre corridas (generado; SE versiona, ver sección de GitHub Actions)
.env                           credenciales locales (generado, no se versiona)
.github/workflows/moodle-check.yml  corrida diaria automática vía GitHub Actions
```

## Cómo se corrió esto localmente

1. **Setup inicial** (una sola vez, interactivo, en tu propia terminal):

   ```bash
   node scripts/get-moodle-token.mjs
   node scripts/get-telegram-chat-id.mjs
   ```

   El primero pide usuario/contraseña de Moodle (la contraseña se enmascara y **nunca se
   guarda en ningún archivo**) y guarda `MOODLE_BASE_URL` + `MOODLE_TOKEN` en `.env`. El
   segundo pide el token del bot de Telegram (creado antes con `@BotFather`) y detecta tu
   `chat_id` automáticamente.

2. **Elegir qué materias monitorear**: correr `npm run list-courses` para ver todos tus
   cursos con su ID, y guardar los que te interesen en `.env` como `MOODLE_COURSE_IDS`
   (separados por coma).

3. **Probar sin mandar nada real**:

   ```bash
   npm run dry-run
   ```

   Imprime por consola el resumen que se mandaría, sin tocar Telegram ni `data/state.json`.

4. **Correr de verdad** (manda el mensaje y actualiza el estado, solo si el envío fue exitoso):

   ```bash
   npm start
   ```

> Nota sobre la primera corrida: la primera vez que se procesa una materia se toma como
> "línea base" — no se listan sus módulos/tareas existentes como si fueran nuevos (para no
> spamear con todo el contenido histórico), pero sí se avisan los vencimientos próximos,
> porque son sensibles al tiempo. De ahí en adelante, cada corrida solo reporta novedades
> reales.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `MOODLE_BASE_URL` | Sí | URL base del aula virtual, ej. `https://aulasvirtuales.bue.edu.ar` |
| `MOODLE_TOKEN` | Sí | Token del Web Service API (servicio `moodle_mobile_app`) |
| `MOODLE_COURSE_IDS` | Sí | IDs de curso a monitorear, separados por coma |
| `TELEGRAM_BOT_TOKEN` | Sí (salvo `--dry-run`) | Token del bot, de `@BotFather` |
| `TELEGRAM_CHAT_ID` | Sí (salvo `--dry-run`) | Chat al que se manda el resumen |
| `DUE_SOON_DAYS` | No (default `3`) | Ventana en días para avisar "vence pronto" |
| `MOODLE_RATE_LIMIT_MS` | No (default `400`) | Pausa entre llamadas por-curso a la API de Moodle |

`index.js` lee estas variables de `process.env` (vía `.env` en local, o directamente del
entorno cuando corre como Routine — `src/env.js` nunca pisa una variable que ya esté seteada
en el entorno).

## Corrida diaria automática (GitHub Actions)

El chequeo diario corre como GitHub Actions workflow
(`.github/workflows/moodle-check.yml`), no como Routine ni como tarea programada local —
ambas alternativas resultaron bloqueadas en este entorno (el proxy de salida del sandbox
rechaza la conexión a `aulasvirtuales.bue.edu.ar`, y el Task Scheduler de Windows está roto
en la PC donde se probó). Los runners de GitHub Actions corren en una red distinta, sin ese
bloqueo.

Como `data/state.json` ya no está en `.gitignore`: tras cada corrida real (no dry-run) el
workflow comitea el estado actualizado de vuelta al repo con el token por defecto
(`GITHUB_TOKEN`, con permiso `contents: write`). Es la forma elegida de persistirlo entre
corridas (alternativa descartada: `actions/cache`, que es best-effort y puede evictarse).

### Setup

1. En GitHub → Settings → Secrets and variables → Actions, cargá estos repository secrets
   (mismos valores que tu `.env` local):
   - `MOODLE_BASE_URL`, `MOODLE_TOKEN`, `MOODLE_COURSE_IDS`
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - (opcional) `DUE_SOON_DAYS`, `MOODLE_RATE_LIMIT_MS`, `FORUM_IGNORE_PATTERN`
2. Pusheá `.github/workflows/moodle-check.yml` al repo.
3. Probá primero a mano: Actions → "Chequeo de Moodle" → Run workflow, con `dry_run` en
   `true` (default). Confirmá en los logs que conecta a Moodle y arma el resumen — esto
   valida que la red de GitHub Actions sí llega a la instancia (a diferencia del sandbox).
4. Si el dry-run funciona, corré el workflow una vez más con `dry_run` en `false` para
   confirmar el envío real a Telegram y el commit de `data/state.json`.
5. De ahí en adelante corre solo todos los días a las 08:00 (Argentina) vía el `schedule`
   del workflow (cron `0 11 * * *`, en UTC).
