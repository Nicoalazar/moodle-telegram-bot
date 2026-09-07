# Aviso de novedades de tu aula virtual (Moodle → Telegram / ntfy)

Bot que revisa tus materias en Moodle y te avisa automáticamente cuando hay algo nuevo:
contenido, tareas, notas, actividad en foros y vencimientos próximos. Corre solo, todos los
días, sin que tengas que entrar a Moodle a revisar nada. Gratis y sin servidores propios
(usa GitHub Actions). No hace falta saber programar — todos los pasos son comandos para
copiar y pegar en una terminal.

## Antes de empezar

- Tu usuario y contraseña de Moodle de tu facultad/instituto.
- [Node.js](https://nodejs.org) 18 o superior instalado.
- [Git](https://git-scm.com/) instalado.
- Una cuenta de [GitHub](https://github.com) (gratis) — para que el chequeo corra solo,
  todos los días, sin que tengas que prender tu computadora.
- Telegram, **o** el celular con la app [ntfy](https://ntfy.sh) — elegís uno de los dos
  (o los dos) para recibir los avisos.

> Esto funciona con cualquier Moodle que tenga habilitado el "Web Service" que usa la app
> móvil oficial — la gran mayoría de las instituciones lo tiene activado, porque si no,
> tampoco funcionaría la app de Moodle en el celular.

## Instalación (una sola vez)

### 1. Conseguí tu copia del proyecto

```bash
git clone https://github.com/Nicoalazar/moodle-telegram-bot
cd moodle-telegram-bot
npm install
```

### 2. Conectá tu cuenta de Moodle

```bash
npm run setup:moodle-token
```

Te va a pedir la URL de tu aula virtual (ej. `https://aulasvirtuales.tufacultad.edu.ar`) y
tu usuario y contraseña. La contraseña se escribe oculta (con `*`) y **nunca se guarda en
ningún archivo** — se usa una sola vez para pedirle un token a Moodle, y ese token (no tu
contraseña) es lo que queda guardado en un archivo `.env` en tu computadora.

> Si te da un error de "servicio no habilitado" o similar, escribile al área de
> sistemas/soporte de tu facultad — puede que ese servicio esté desactivado.

### 3. Elegí qué materias querés que se revisen

```bash
npm run list-courses
```

Te muestra todas tus materias con su ID. Copiá los IDs que te interesen (separados por
coma) y pegalos en el archivo `.env`, en la línea `MOODLE_COURSE_IDS=`.

### 4. Elegí cómo querés recibir los avisos

**Opción A — Telegram** (si ya lo usás a diario):

1. En Telegram, buscá **@BotFather** y mandale `/newbot`. Elegí un nombre y un usuario para
   tu bot (debe terminar en "bot", ej. `mi_aula_bot`).
2. Copiá el token que te devuelve.
3. Buscá tu bot recién creado y mandale cualquier mensaje (ej. "hola").
4. Corré:
   ```bash
   npm run setup:telegram-chat-id
   ```
   Te pide el token del bot y detecta tu chat automáticamente.

**Opción B — ntfy** (más simple, no requiere crear nada ni ninguna cuenta):

1. Instalá la app [ntfy](https://ntfy.sh/docs/subscribe/phone/) en tu celular, o abrí
   [ntfy.sh](https://ntfy.sh) desde el navegador.
2. Pensá un nombre de "topic" único que nadie más vaya a adivinar (cualquiera que lo
   conozca puede ver tus avisos), por ejemplo `aula-tunombre-1234`.
3. Suscribite a ese nombre desde la app (botón "+").
4. Abrí tu archivo `.env` y agregá:
   ```
   NOTIFY_CHANNELS=ntfy
   NTFY_TOPIC_URL=https://ntfy.sh/aula-tunombre-1234
   ```
   (reemplazando por el nombre que elegiste en el paso 2)

¿Querés los dos a la vez? `NOTIFY_CHANNELS=telegram,ntfy` (con las variables de ambos
configuradas).

### 5. Probalo sin mandar nada real

```bash
npm run dry-run
```

Muestra por pantalla exactamente lo que te mandaría, sin enviar ningún mensaje. Revisá que
las materias y el resumen tengan sentido antes de seguir.

### 6. Mandá el primer aviso de verdad

```bash
npm start
```

> **La primera corrida no te avisa sobre todo lo que ya existe en tus materias** (así no te
> inunda con el contenido histórico apenas empezás) — solo avisa vencimientos que estén
> próximos. De la segunda corrida en adelante, vas a recibir solo lo genuinamente nuevo.

## Automatizarlo (para que corra solo, todos los días)

Para no tener que acordarte de correrlo vos, se programa con **GitHub Actions** (gratis,
corre en los servidores de GitHub — tu computadora puede estar apagada).

1. Subí tu copia del proyecto a un repositorio de GitHub propio, marcado como **privado**
   (tiene tu configuración de materias, aunque no tus contraseñas).
2. En ese repositorio: **Settings → Secrets and variables → Actions → New repository
   secret**, y cargá ahí los mismos valores que tenés en tu `.env` local: `MOODLE_BASE_URL`,
   `MOODLE_TOKEN`, `MOODLE_COURSE_IDS`, y según el canal que elegiste, `TELEGRAM_BOT_TOKEN` +
   `TELEGRAM_CHAT_ID` y/o `NOTIFY_CHANNELS` + `NTFY_TOPIC_URL`.
3. **Settings → Actions → General → Workflow permissions**, elegí **"Read and write
   permissions"** (así el workflow puede guardar su propio progreso entre corridas).
4. Listo — el workflow ya viene armado (`.github/workflows/moodle-check.yml`), corriendo
   automáticamente lunes y viernes a las 8:17 AM (hora Argentina; ajustable, ver más abajo).
   Para probarlo sin esperar: pestaña **Actions** del repo → "Chequeo de Moodle" →
   **Run workflow**.

## Problemas comunes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| "Web services are not enabled" al pedir el token | Tu facultad no tiene habilitado el servicio para apps móviles | Consultá con el área de sistemas/IT de tu institución |
| No me llega nada por Telegram | No le mandaste un mensaje al bot antes de correr `setup:telegram-chat-id` | Mandale un mensaje al bot y volvé a correr ese script |
| No me llega nada por ntfy | No te suscribiste al topic, o el nombre no coincide exactamente | Revisá que el nombre en la app sea idéntico al de `NTFY_TOPIC_URL` |
| El workflow de GitHub Actions no corrió a la hora esperada | Los cron de GitHub pueden demorarse (rara vez, hasta varias horas) en momentos de mucha carga en la plataforma | Es ocasional y esperable; podés dispararlo a mano desde la pestaña Actions mientras tanto |
| Avisa algo que ya vi o completé | Puede pasar la primera vez que se agrega una categoría nueva de avisos (ej. foros o notas) sobre un `state.json` que ya existía de antes | Es un aviso único, no se repite en la corrida siguiente |

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `MOODLE_BASE_URL` | Sí | URL base de tu aula virtual |
| `MOODLE_TOKEN` | Sí | Token del Web Service de Moodle (lo genera `npm run setup:moodle-token`) |
| `MOODLE_COURSE_IDS` | Sí | IDs de las materias a monitorear, separados por coma |
| `NOTIFY_CHANNELS` | No (default `telegram`) | `telegram`, `ntfy`, o `telegram,ntfy` para ambos |
| `TELEGRAM_BOT_TOKEN` | Sí si usás `telegram` (salvo `--dry-run`) | Token del bot, de `@BotFather` |
| `TELEGRAM_CHAT_ID` | Sí si usás `telegram` (salvo `--dry-run`) | Chat al que se manda el resumen |
| `NTFY_TOPIC_URL` | Sí si usás `ntfy` (salvo `--dry-run`) | URL de tu topic en ntfy.sh |
| `DUE_SOON_DAYS` | No (default `7`) | Ventana en días para avisar "vence pronto" |
| `MOODLE_RATE_LIMIT_MS` | No (default `400`) | Pausa entre llamadas por-curso/por-foro a la API de Moodle |
| `FORUM_IGNORE_PATTERN` | No | Regex (case-insensitive) de nombres de foro a NO rastrear — default excluye foros de "oficina/grupo" de comisiones ajenas |

`index.js` lee estas variables de `process.env` (vía `.env` en local, o directamente del
entorno en GitHub Actions vía Secrets — nunca se sobreescribe una variable que ya esté
seteada en el entorno).

## Estructura del proyecto

```
index.js                             orquestación completa: junta todo y decide qué avisar
src/env.js                           lee/escribe .env (sin dependencias externas)
src/moodleClient.js                  cliente REST de Moodle
src/state.js                         guarda qué ya viste y calcula qué es genuinamente nuevo
src/telegram.js                      arma el resumen y lo manda por Telegram
src/ntfy.js                          arma el resumen y lo manda por ntfy
scripts/get-moodle-token.mjs         setup interactivo: obtiene tu MOODLE_TOKEN
scripts/get-telegram-chat-id.mjs     setup interactivo: obtiene tu TELEGRAM_CHAT_ID
scripts/list-courses.mjs             utilidad: lista tus materias con su ID
data/state.json                      qué ya se avisó (se versiona, ver sección de GitHub Actions)
.env                                 tus credenciales locales (generado, NO se versiona)
.github/workflows/moodle-check.yml   corrida automática vía GitHub Actions
```

## Notas técnicas (para quien quiera tocar el código)

- **Por qué GitHub Actions y no un cron local o una nube externa**: no depende de que tu
  computadora esté prendida, y corre en una red sin restricciones de salida hacia Moodle.
- **Cómo persiste el estado entre corridas**: como cada corrida de GitHub Actions arranca de
  cero, `data/state.json` **sí** se versiona (a diferencia de un uso 100% local), y el
  workflow lo comitea de vuelta al repo al final de cada corrida real (con reintento
  automático si choca con otro push concurrente).
- **Horario del cron**: a propósito no está en punto (`17 11 * * 1,5`, no `0 11 * * 1,5`) —
  los cron en punto compiten con muchísimos workflows de toda la plataforma agendados a la
  misma hora, y GitHub puede llegar a descartar el disparo en vez de solo demorarlo.
- **Primera corrida por materia**: no lista módulos/tareas ya existentes como "nuevos" (para
  no volcar todo el historial), salvo vencimientos próximos, que sí avisa siempre por ser
  sensibles al tiempo.
