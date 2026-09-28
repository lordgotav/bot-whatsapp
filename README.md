# 🤖 Bot de WhatsApp — Monitoreo de Turno (grupo)

## Archivos
- `bot.js` — todo el bot (webhook, menú 1-12, descarga, subida a Supabase, avance).
- `package.json` — dependencias (express, supabase, dotenv).
- `.env.example` — copia a `.env` y llena tus datos.

## Cómo correrlo localmente (prueba)
1. Instala Node 18+ en tu PC (https://nodejs.org).
2. `npm install`  (una vez)
3. Copia `.env.example` → `.env` y llena los valores.
4. `npm start`  → verás "Bot activo en el puerto 3000".
5. Expón el puerto al mundo (solo para pruebas con Meta):
   - ngrok: `ngrok http 3000` → te da una URL `https://xxxx.ngrok.io`
   - En Meta usa esa URL como Callback: `https://xxxx.ngrok.io/webhook/wa`

## Desplegar 24/7 en Render (recomendado, gratis)
1. Sube esta carpeta a un repositorio de GitHub (o usa "Blueprint" de Render).
2. En Render: **New → Web Service** → conecta tu repo.
3. Build: `npm install` · Start: `npm start` · Runtime: Node.
4. En **Environment** pega los campos del `.env`.
5. Render te da una URL tipo `https://tu-bot.onrender.com`.
6. En Meta, Callback URL = `https://tu-bot.onrender.com/webhook/wa` + tu VERIFY_TOKEN.
7. Activa el campo **messages** y pulsa Verify.

## Cómo se configura en Meta (resumen)
1. App en developers.facebook.com → WhatsApp → Setup.
2. Copia WHATSAPP_TOKEN y PHONE_NUMBER_ID al `.env`.
3. En la app: **Configuration** → Webhook → Callback URL + Verify token.
4. Agrega tu celular como destinatario (prueba).
5. Agrega el número del bot al grupo de WhatsApp.

## Variables importantes
| Variable | Descripción |
|----------|-------------|
| `TURNO_ID` | id del turno en `monitoreo_turnos` (una sola obra) |
| `OBRA` | nombre de la obra (alternativa si TURNO_ID vacío) |
| `SUPABASE_SERVICE_KEY` | clave service_role (privada) |

## Varias obras (multi-obra)
Si hay **varias obras** que suben monitoreo:
- Deja `TURNO_ID` y `OBRA` **vacíos**.
- La primera vez que cada supervisor le escribe al bot, este le pregunta
  **"¿En qué obra estás?"** con la lista de obras activas y elige con un número.
- El bot **recuerda** su obra (tabla `supervisor_turnos`) y la usa para sus
  evidencias y avance. Para cambiar: escribe **"cambiar obra"**.
- ⚠️ Requiere correr el SQL que crea la tabla `supervisor_turnos`
  (está en `supabase-setup.sql`, sección 10) una sola vez en Supabase.

## Flujo que hace el bot
foto/PDF → menú 1-12 → elige sección → sube al bucket `media` → INSERT en
`monitoreo_envios` (fecha hoy, turno de la obra, remitente) → responde
"✅ … Avance X/12 (Y%)".