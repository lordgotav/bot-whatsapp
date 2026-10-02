// ============================================================
//  BOT WHATSAPP — MONITOREO DE TURNO (grupo)
//  Recibe fotos/PDF del supervisor, pregunta sección 1-12,
//  sube la evidencia a Supabase (bucket "media") y registra en
//  monitoreo_envios, respondiendo con el avance del turno.
// ------------------------------------------------------------
//  Proveedor de WhatsApp (variable PROVEEDOR en .env):
//   - 'meta'   (predeterminado): WhatsApp Cloud API (Meta)
//   - 'zernio' : Zernio API (https://zernio.com) — oficial, sin
//     crear app en Meta; solo API key + webhook /webhook/zernio
// ------------------------------------------------------------
//  Requiere Node 18+ (instala: https://nodejs.org)
//  Instalación local (una vez):   npm install
//  Correr localmente:             npm start
//  Desplegar en nube 24/7:        Render / Railway / Fly.io
// ============================================================

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

/* ---------------- CONFIGURACIÓN (se carga desde .env) ---------------- */
const PROVEEDOR = (process.env.PROVEEDOR || 'meta').toLowerCase();

// --- Modo Meta (WhatsApp Cloud API) ---
const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v19.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mi-token-de-verificacion';

// --- Modo Zernio (API oficial via Zernio) ---
const ZERNIO_URL = 'https://zernio.com/api/v1';
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY;
// Secret que defines tú en POST /v1/webhooks/settings (firma HMAC de los webhooks).
// Si lo dejas vacío, el bot NO valida la firma (menos seguro).
const ZERNIO_WEBHOOK_SECRET = process.env.ZERNIO_WEBHOOK_SECRET || '';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ID del turno en la tabla monitoreo_turnos (mira en Supabase Table Editor).
// Si lo dejas vacío, el bot usa OBRA (o el primer turno activo).
const TURNO_ID = process.env.TURNO_ID ? Number(process.env.TURNO_ID) : null;
const OBRA = process.env.OBRA || '';

if (PROVEEDOR === 'zernio') {
  if (!ZERNIO_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Faltan variables ZERNIO_API_KEY, SUPABASE_URL o SUPABASE_SERVICE_KEY. Revisa tu archivo .env');
    process.exit(1);
  }
} else if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Faltan variables de entorno. Revisa tu archivo .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const app = express();
// El verify captura el body crudo (lo necesita la firma HMAC de Zernio).
app.use(express.json({ limit: '15mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

/* ---------------- MENÚ 1-12 → CLAVES REALES DE TU BASE ---------------- */
const MENU = [
  { n: 1,  clave: 'fuerza',          etiqueta: '👷 Verificación de la fuerza de trabajo (11:00 p.m.)', tipo: 'texto' },
  { n: 2,  clave: 'platica',         etiqueta: '🗣️ Plática de seguridad antes del inicio', tipo: 'foto' },
  { n: 3,  clave: 'permisos',        etiqueta: '📄 Liberación de permisos de trabajo', tipo: 'foto_pdf' },
  { n: 4,  clave: 'apr',             etiqueta: '🧯 Análisis de riesgos (APR)', tipo: 'foto_pdf' },
  { n: 5,  clave: 'herramientas',    etiqueta: '🔧 Inspección y liberación de herramientas, escaleras, extensiones eléctricas y extintores', tipo: 'foto_pdf' },
  { n: 6,  clave: 'delimitaciones',  etiqueta: '🚧 Evidencia de las delimitaciones antes del inicio', tipo: 'foto' },
  { n: 7,  clave: 'recorridos',      etiqueta: '📸 Recorridos de seguridad y envío de evidencia cada hora al grupo interno', tipo: 'foto' },
  { n: 8,  clave: 'siga',            etiqueta: '📁 Verificación de la colocación de la carpeta SIGA', tipo: 'foto' },
  { n: 9,  clave: 'loto',            etiqueta: '🔒 Verificación del procedimiento LOTO (cuando aplique)', tipo: 'foto' },
  { n: 10, clave: 'pausa',           etiqueta: '⏸ Pausa de seguridad (cuando aplique)', tipo: 'foto' },
  { n: 11, clave: 'orden',           etiqueta: '🧹 Evidencia de orden y limpieza en las áreas de trabajo', tipo: 'foto' },
  { n: 12, clave: 'cierre_permisos', etiqueta: '✅ Cierre de permisos de trabajo', tipo: 'foto_pdf' }
];

// Estado en memoria por remitente: { paso: 'obra' | 'seccion' | 'login_usuario' | 'login_clave', ... }
//  - paso 'obra': está eligiendo su obra (multi-obra)
//  - paso 'seccion': eligió sección del menú y espera su evidencia
//  - paso 'login_*': se está identificando (usuario + contraseña)
const sesiones = new Map();

// Remitentes ya identificados (usuario + contraseña correctos)
//  wa_id -> { user_id, usuario, nombre }
const autenticados = new Map();

// Canales Zernio para responder (normNum(wa) -> { conversationId, accountId })
const canales = new Map();
let zernioAccountId = null;

// Dedupe de webhooks Zernio (sus eventos llegan "al menos una vez")
const vistos = new Set();

function intlWaId(waId) { const d = normNum(waId); return (d.startsWith('+') ? '' : '+') + d; }

function recordarCanal(destinatario, conversationId, accountId) {
  if (!destinatario || !conversationId || !accountId) return;
  zernioAccountId = accountId;
  canales.set(normNum(destinatario), { conversationId, accountId });
}

function firmaValida(rawBody, sig) {
  if (!ZERNIO_WEBHOOK_SECRET) return true; // sin secret configurado no se valida (recomendable ponerlo)
  if (!rawBody || !sig) return false;
  const calc = crypto.createHmac('sha256', ZERNIO_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(sig);
  return a.length === b.length && a.equals(b);
}

/* ---------------- UTILIDADES ---------------- */
function hoy() { return new Date().toISOString().slice(0, 10); }
function horaLocal() { return new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function normNum(n) { return String(n || '').replace(/\D/g, ''); }
function normaTxt(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function mismoCelular(wa, cel) {
  const a = normNum(wa).slice(-10), b = normNum(cel).slice(-10);
  return a && b && a === b;
}

function textoMenu() {
  return 'Para abrir las opciones solo di la palabra "Menu".\n\n' +
    '📋 ¿De qué sección? Responde:\n\n' +
    MENU.map(m => `${m.n}) ${m.etiqueta}`).join('\n') +
    '\n\n(Manda "0" para cancelar la sección en curso.)';
}

async function enviar(destinatario, body) {
  if (PROVEEDOR === 'zernio') return enviarZernio(destinatario, body);
  try {
    const res = await fetch(`${GRAPH_URL}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: destinatario, type: 'text', text: { body } })
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error('enviar ERROR', res.status, txt.slice(0, 500));
    } else {
      console.log('enviar OK ->', destinatario);
    }
  } catch (e) { console.error('enviar:', e.message); }
}

// Envío por Zernio: se responde dentro de la conversación que abrió el usuario.
async function enviarZernio(destinatario, body) {
  try {
    let canal = canales.get(normNum(destinatario));
    if (!canal) {
      if (!zernioAccountId) { console.error('enviarZernio: sin canal ni cuenta para', destinatario); return; }
      const resC = await fetch(`${ZERNIO_URL}/inbox/conversations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ZERNIO_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: zernioAccountId, participantId: intlWaId(destinatario), message: body })
      });
      const jC = await resC.json().catch(() => ({}));
      if (!resC.ok) { console.error('enviarZernio crearConversacion ERROR', resC.status, JSON.stringify(jC).slice(0, 500)); return; }
      if (jC && jC.data && jC.data.conversationId) {
        canal = { conversationId: jC.data.conversationId, accountId: zernioAccountId };
        canales.set(normNum(destinatario), canal);
        console.log('enviar OK ->', destinatario);
        return;
      }
      console.error('enviarZernio: la conversación no regresó id'); return;
    }
    const res = await fetch(`${ZERNIO_URL}/inbox/conversations/${canal.conversationId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ZERNIO_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: canal.accountId, message: body })
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error('enviarZernio ERROR', res.status, txt.slice(0, 500));
    } else {
      console.log('enviar OK ->', destinatario);
    }
  } catch (e) { console.error('enviarZernio:', e.message); }
}

// Descarga la media entrante. Con Zernio llega un URL autenticado
// (hay que pedirlo con el API key); con Meta llega el id de Graph.
async function descargarMedia(media) {
  const mediaObj = (media && typeof media === 'object') ? media : {};
  if (mediaObj.url) {
    const token = PROVEEDOR === 'zernio' ? ZERNIO_API_KEY : WHATSAPP_TOKEN;
    const r2 = await fetch(mediaObj.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r2.ok) throw new Error('media HTTP ' + r2.status);
    const mime = mediaObj.mime_type || mediaObj.mimeType || '';
    return { buffer: Buffer.from(await r2.arrayBuffer()), mime };
  }
  const r1 = await fetch(`${GRAPH_URL}/${media}`, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
  const info = await r1.json();
  const r2 = await fetch(info.url, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
  return { buffer: Buffer.from(await r2.arrayBuffer()), mime: info.mime_type || '' };
}

// Lista de turnos activos (para multi-obra y para elegir obra)
async function turnosDisponibles() {
  const { data, error } = await supabase.from('monitoreo_turnos').select('*').eq('activo', true).order('created_at', { ascending: false });
  if (error) { console.error('turnosDisponibles:', error.message); return []; }
  return data || [];
}

// Memoria permanente (tabla supervisor_turnos): qué obra eligió cada supervisor
async function memorizarTurno(remitente, turnoId) {
  try {
    await supabase.from('supervisor_turnos')
      .upsert({ wa_id: remitente, turno_id: turnoId, updated_at: new Date().toISOString() });
  } catch (e) { console.error('memorizarTurno:', e.message); }
}
async function olvidarTurno(remitente) {
  try {
    await supabase.from('supervisor_turnos').delete().eq('wa_id', remitente);
  } catch (e) { console.error('olvidarTurno:', e.message); }
}

// Resuelve el turno de un remitente:
//  - si TURNO_ID u OBRA están fijos en .env, usa ese (modo una sola obra)
//  - si no, usa la obra que el supervisor eligió (guardada en supervisor_turnos)
//  - devuelve null si falta elegir obra (multi-obra) o no hay turno
async function resolverTurno(remitente) {
  try {
    if (TURNO_ID) {
      const { data } = await supabase.from('monitoreo_turnos').select('*').eq('id', TURNO_ID).limit(1);
      if (data && data[0]) return data[0];
    }
    if (OBRA) {
      const { data } = await supabase.from('monitoreo_turnos').select('*').eq('obra', OBRA).eq('activo', true).limit(1);
      if (data && data[0]) return data[0];
    }
    const { data: mem } = await supabase.from('supervisor_turnos').select('turno_id').eq('wa_id', remitente).limit(1);
    if (mem && mem[0]) {
      const { data: t } = await supabase.from('monitoreo_turnos').select('*').eq('id', mem[0].turno_id).eq('activo', true).limit(1);
      if (t && t[0]) return t[0];
    }
    return null;
  } catch (e) { console.error('resolverTurno:', e.message); return null; }
}

async function buscarUsuario(waId) {
  const { data } = await supabase.from('perfiles').select('id, nombre, celular');
  const p = (data || []).find(x => mismoCelular(waId, x.celular));
  return p || null;
}

// Si el número no está en la app, generamos un UUID estable para ese remitente
// (así el avance por persona funciona aunque no use la app).
function uuidDeRemitente(waId) {
  const crypto = require('crypto');
  const h = crypto.createHash('sha1').update('wa:' + waId).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; // versión 5
  h[8] = (h[8] & 0x3f) | 0x80; // variante RFC
  const s = h.toString('hex');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

async function calcularAvance(turno, userId, claveNueva) {
  const activos = Array.isArray(turno.formularios) && turno.formularios.length
    ? turno.formularios
    : MENU.map(m => m.clave);
  const { data } = await supabase.from('monitoreo_envios')
    .select('form_clave').eq('turno_id', turno.id).eq('fecha', hoy()).eq('user_id', userId);
  const set = new Set((data || []).map(r => r.form_clave));
  set.add(claveNueva);
  const hecho = activos.filter(c => set.has(c)).length;
  const total = activos.length;
  const pct = total ? Math.round(hecho / total * 100) : 0;
  return { hecho, total, pct };
}

function comentario(pct) {
  if (pct >= 100) return '🎉 ¡Cumplimiento al 100%!';
  if (pct >= 75) return '🔥 ¡Excelente! Casi listo.';
  if (pct >= 50) return '👍 Vas muy bien, sigue así.';
  if (pct >= 25) return '🙂 ¡Buen avance! Continúa con los pendientes.';
  return '👣 Vas empezando, ve completando los puntos.';
}

/* ---------------- MULTI-OBRA: preguntar y guardar la obra del supervisor ---------------- */
async function preguntarObra(remitente, destinatario, mensajeInicial) {
  if (TURNO_ID || OBRA) return; // modo una sola obra: no preguntar
  const ts = (await turnosDisponibles()).filter(t => t.activo !== false);
  if (!ts.length) { await enviar(destinatario, '⚠️ No hay turnos activos en monitoreo_turnos. Configúralos en la app.'); return; }
  sesiones.set(remitente, { paso: 'obra', obraTs: ts });
  await enviar(destinatario,
    (mensajeInicial || '🏗️ ¿En qué obra estás? Escribe el *nombre* de la obra o su *número*:') + '\n\n' +
    ts.map((t, i) => `${i + 1}) ${t.obra}`).join('\n') +
    '\n\n(0) para cancelar.');
}

async function elegirObra(remitente, destinatario, texto) {
  const sesion = sesiones.get(remitente) || {};
  const ts = sesion.obraTs || (await turnosDisponibles()).filter(t => t.activo !== false);

  // 1) Intentar por número (1, 2, 3...)
  const idx = Number(texto) - 1;
  if (Number.isInteger(idx) && idx >= 0 && idx < ts.length) {
    return elegirObraConfirmada(remitente, destinatario, ts[idx]);
  }

  // 2) Intentar por nombre escrito (sin acentos ni mayúsculas)
  const q = normaTxt(texto);
  const coinciden = ts.filter(t => {
    const nm = normaTxt(t.obra);
    return nm === q || nm.includes(q) || q.includes(nm);
  });

  if (coinciden.length === 1) {
    return elegirObraConfirmada(remitente, destinatario, coinciden[0]);
  }
  if (coinciden.length > 1) {
    sesiones.set(remitente, { paso: 'obra', obraTs: coinciden });
    await enviar(destinatario, 'Hay varias obras con ese nombre, dime el número:\n\n' +
      coinciden.map((t, i) => `${i + 1}) ${t.obra}`).join('\n'));
    return;
  }
  await enviar(destinatario, '⚠️ No encontré esa obra. Escribe el nombre completo o el número de la lista:\n\n' +
    ts.map((t, i) => `${i + 1}) ${t.obra}`).join('\n'));
}

async function elegirObraConfirmada(remitente, destinatario, turno) {
  await memorizarTurno(remitente, turno.id);
  sesiones.delete(remitente);
  await enviar(destinatario, `✅ Obra *'${turno.obra}'* seleccionada.\n\n` + textoMenu());
}

/* ---------------- GUARDADO DE EVIDENCIAS ---------------- */
async function guardarEvidencia(remitente, destinatario, seccion, mediaMeta, tipoMsg) {
  const turno = await resolverTurno(remitente);
  if (!turno) { await enviar(destinatario, '⚠️ No encontré tu obra. Escribe *cambiar obra* para elegirla.'); return; }

  let mediaJson = null;
  try {
    const { buffer, mime } = await descargarMedia(mediaMeta);
    // Subir al bucket "media" (la misma ruta que usa la app)
    const esPdf = mime === 'application/pdf' || (mediaMeta.mime_type || '').includes('pdf');
    const ext = esPdf ? 'pdf' : 'jpg';
    const tipo = esPdf ? 'pdf' : 'foto';
    const auth = autenticados.get(remitente);
    const usuario = await buscarUsuario(remitente);
    const userId = (auth && auth.user_id) || (usuario ? usuario.id : uuidDeRemitente(remitente));
    const prefijo = esPdf ? 'monitoreo_form_pdf' : 'monitoreo_form_foto';
    const ruta = `${userId}/${Date.now()}_${prefijo}.${ext}`;

    const { error: errSub } = await supabase.storage.from('media').upload(ruta, buffer, { contentType: mime, upsert: false });
    if (errSub) throw errSub;
    mediaJson = [{ ruta, tipo, nombre: esPdf ? 'documento.pdf' : `foto-${Date.now()}.jpg` }];

    const { error: errIns } = await supabase.from('monitoreo_envios').insert({
      turno_id: turno.id,
      fecha: hoy(),
      form_clave: seccion.clave,
      user_id: userId,
      nombre: (auth && auth.nombre) || (usuario && usuario.nombre) || 'Supervisor (WhatsApp)',
      texto: seccion.clave === 'apr' ? '[Evidencia APR subida]' : '',
      media: mediaJson
    });
    if (errIns) throw errIns;

    const { hecho, total, pct } = await calcularAvance(turno, userId, seccion.clave);
    const obra = turno.obra || 'la obra';
    await enviar(destinatario,
      `✅ ${seccion.etiqueta}, registrado en '${obra}' a las ${horaLocal()}.\n` +
      `Avance ${hecho}/${total} formularios. ${comentario(pct)}\n\n` +
      `Para abrir el menu de opciones di la palabra "Menu"; para cargar otra Evidencia (Foto/PDF) vuelve a marcar el número de la sección donde quieres subir la evidencia.`);
  } catch (ex) {
    console.error('guardarEvidencia:', ex.message);
    await enviar(destinatario, '⚠️ Ocurrió un error al subir la evidencia. Inténtalo de nuevo.');
  } finally {
    sesiones.delete(remitente);
  }
}

async function guardarTextoFuerza(remitente, destinatario, seccion, texto) {
  const turno = await resolverTurno(remitente);
  if (!turno) { await enviar(destinatario, '⚠️ No encontré tu obra. Escribe *cambiar obra* para elegirla.'); return; }
  try {
    const auth = autenticados.get(remitente);
    const usuario = await buscarUsuario(remitente);
    const userId = (auth && auth.user_id) || (usuario ? usuario.id : uuidDeRemitente(remitente));
    const { error } = await supabase.from('monitoreo_envios').insert({
      turno_id: turno.id, fecha: hoy(), form_clave: seccion.clave,
      user_id: userId, nombre: (auth && auth.nombre) || (usuario && usuario.nombre) || 'Supervisor (WhatsApp)',
      texto, media: []
    });
    if (error) throw error;
    const { hecho, total, pct } = await calcularAvance(turno, userId, seccion.clave);
    const obra = turno.obra || 'la obra';
    await enviar(destinatario,
      `✅ ${seccion.etiqueta}, registrado en '${obra}' a las ${horaLocal()}.\n` +
      `Avance ${hecho}/${total} formularios. ${comentario(pct)}\n\n` +
      `Para abrir el menu de opciones di la palabra "Menu"; para cargar otra Evidencia (Foto/PDF) vuelve a marcar el número de la sección donde quieres subir la evidencia.`);
  } catch (ex) {
    console.error('guardarTextoFuerza:', ex.message);
    await enviar(destinatario, '⚠️ Ocurrió un error al guardar. Inténtalo de nuevo.');
  } finally {
    sesiones.delete(remitente);
  }
}

/* ---------------- MARCADO SIN FOTO (tarea repetitiva) ---------------- */
// Ej.: "ya subí mis apr" → marca esa sección como cumplida hoy sin volver a subir la foto.
// Atajo sin foto SOLO para: APR, LOTO, Pausa y Cierre de permisos.
// El marcador es el mismo texto que usa la app para tildar (✅ cumplido).
const TILDES = [
  { clave: 'apr',             etiqueta: 'Análisis de riesgos (APR)', marcador: '[Evidencia APR subida]',            re: /apr/ },
  { clave: 'cierre_permisos', etiqueta: 'Cierre de permisos de trabajo', marcador: '[Sin cierre de permisos hoy] Sin Cierre Permisos hoy', re: /cierre\s*(de)?\s*permisos?|cerraron\s*permisos|encargad/ },
  { clave: 'pausa',           etiqueta: 'Pausa de seguridad (cuando aplique)', marcador: 'Sin Pausa hoy',                     re: /pausa/ },
  { clave: 'loto',            etiqueta: 'Verificación del procedimiento LOTO (cuando aplique)', marcador: 'Sin LOTOs hoy',                     re: /loto/ }
];
// Para marcar sin foto, el mensaje debe parecer una confirmación/estado del día:
const ACTIVADOR = /ya\s+(sub[ií]|envi[ée]|mand[ée]|puse|tengo|realic|realiz)|no\s+se\s+(realiz|hicieron|hizo)|no\s+(llegaron|hay|hubo)|sin\s+|cumplido|hoy\b/;

async function marcarConfirmacionTexto(remitente, destinatario, texto) {
  const t = texto.toLowerCase();
  if (!ACTIVADOR.test(t)) return false;
  const trozo = t.replace(/[^a-záéíóúñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const seccion = TILDES.find(x => x.re.test(trozo));
  if (!seccion) return false;
  const turno = await resolverTurno(remitente);
  if (!turno) { await enviar(destinatario, '⚠️ No encontré tu obra. Escribe *cambiar obra* si la eliges diferente.'); return false; }
  const auth = autenticados.get(remitente);
  const usuario = await buscarUsuario(remitente);
  const userId = (auth && auth.user_id) || (usuario ? usuario.id : uuidDeRemitente(remitente));
  const nombre = (auth && auth.nombre) || (usuario && usuario.nombre) || 'Supervisor (WhatsApp)';
  try {
    const { data: existentes } = await supabase.from('monitoreo_envios')
      .select('id').eq('turno_id', turno.id).eq('fecha', hoy()).eq('user_id', userId).eq('form_clave', seccion.clave);
    if (existentes && existentes.length) {
      await enviar(destinatario, `ℹ️ Ese punto ya está marcado para hoy (${seccion.etiqueta}).`);
      return true;
    }
    const marcador = seccion.marcador;
    await supabase.from('monitoreo_envios').insert({
      turno_id: turno.id, fecha: hoy(), form_clave: seccion.clave,
      user_id: userId, nombre, texto: marcador, media: []
    });
    const { hecho, total, pct } = await calcularAvance(turno, userId, seccion.clave);
    await enviar(destinatario,
      `✅ ${seccion.etiqueta} marcado como cumplido hoy sin nueva evidencia.\n` +
      `Avance ${hecho}/${total} formularios. ${comentario(pct)}\n\n` +
      `Para abrir el menu de opciones di la palabra "Menu"; para cargar otra Evidencia (Foto/PDF) vuelve a marcar el número de la sección donde quieres subir la evidencia.`);
    sesiones.delete(remitente);
    return true;
  } catch (ex) {
    console.error('marcarConfirmacionTexto:', ex.message);
    await enviar(destinatario, '⚠️ Ocurrió un error al marcar. Inténtalo de nuevo.');
    return true;
  }
}

/* ---------------- SEGURIDAD: usuario + contraseña ---------------- */
// Se usa Supabase Auth: el mismo correo+contraseña que usa la página.
// El id de auth.users ES el id de perfiles, así la evidencia cae en el
// perfil correcto y el cumplimiento se calcula con esas claves.
function estaAutenticado(remitente) { return autenticados.has(remitente); }

async function iniciarLogin(remitente, destinatario) {
  sesiones.set(remitente, { paso: 'login_usuario' });
  await enviar(destinatario, '🔐 Para reportar necesitas identificarte.\n\nEscribe tu *correo electrónico* (el mismo con el que entras a la página) o "0" para cancelar.');
}

// Procesa los pasos del login. Devuelve true si consumió el mensaje.
async function procesarLogin(remitente, destinatario, sesion, texto) {
  if (texto === '0') {
    sesiones.delete(remitente);
    await enviar(destinatario, '✅ Identificación cancelada.');
    return true;
  }
  try {
    if (sesion.paso === 'login_usuario') {
      const email = texto.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await enviar(destinatario, 'Eso no parece un correo válido. Escríbelo de nuevo o "0" para cancelar.');
        return true;
      }
      sesiones.set(remitente, { paso: 'login_clave', usuario: email });
      await enviar(destinatario, 'Ahora escribe tu *contraseña* (la misma de la página).');
      return true;
    }
    if (sesion.paso === 'login_clave') {
      // Valida contra Supabase Auth: el mismo correo+contraseña que usa la página.
      const { data, error } = await supabase.auth.signInWithPassword({ email: sesion.usuario, password: texto });
      if (error || !data.user) {
        sesiones.delete(remitente);
        await enviar(destinatario, '❌ Correo o contraseña incorrectos. Vuelve a escribir tu *correo*.');
        return true;
      }
      const uid = data.user.id;
      const { data: prof } = await supabase.from('perfiles').select('id, nombre').eq('id', uid).maybeSingle();
      const nombre = (prof && prof.nombre) || sesion.usuario.split('@')[0];
      autenticados.set(remitente, { user_id: uid, usuario: sesion.usuario, nombre });
      sesiones.delete(remitente);
      await enviar(destinatario, `✅ ¡Hola ${nombre}! Identificación correcta.`);
      if (!TURNO_ID && !OBRA) return preguntarObra(remitente, destinatario); // multi-obra: elige su obra
      const turno = await resolverTurno(remitente);
      if (!turno) { await enviar(destinatario, '⚠️ No hay un turno activo para tu obra. Configúralo en la app.'); return true; }
      await enviar(destinatario, textoMenu());
      return true;
    }
  } catch (e) {
    console.error('procesarLogin:', e.message);
    sesiones.delete(remitente);
    await enviar(destinatario, '⚠️ Falló la verificación. Vuelve a escribir tu *correo*.');
    return true;
  }
  return false;
}

/* ---------------- PROCESAR MENSAJES ---------------- */
async function procesar(val, msg) {
  const remitente = msg.from;
  const destinatario = (msg.context && msg.context.group_id) || remitente; // grupo o DM
  const tipo = msg.type;
  const esTexto = tipo === 'text';
  const texto = esTexto ? ((msg.text && msg.text.body) || '').trim() : '';
  const sesion = sesiones.get(remitente) || {};

  // 🔐 SEGURIDAD: sin usuario+contraseña no se puede hacer nada
  if (sesion.paso === 'login_usuario' || sesion.paso === 'login_clave') {
    if (esTexto) return procesarLogin(remitente, destinatario, sesion, texto);
    await enviar(destinatario, 'Escribe solo texto (correo o contraseña).');
    return;
  }
  if (!estaAutenticado(remitente)) {
    return iniciarLogin(remitente, destinatario);
  }

  // Comando para cambiar de obra (multi-obra)
  if (esTexto && /^(cambiar|cambio|obra)\b/i.test(texto)) {
    await olvidarTurno(remitente);
    return preguntarObra(remitente, destinatario, '🏗️ ¿A qué obra te cambias? Escribe el *nombre* o el *número*:');
  }

  // Está eligiendo obra → el número que mande es su obra
  if (sesion.paso === 'obra') {
    if (esTexto && texto !== '0') return elegirObra(remitente, destinatario, texto);
    if (esTexto && texto === '0') { sesiones.delete(remitente); await enviar(destinatario, '✅ Cancelado.'); return; }
    await enviar(destinatario, 'Responde con el número de tu obra de la lista.');
    return;
  }

  // Resuelve el turno (obra fija en .env u obra que ya eligió el supervisor)
  const turno = await resolverTurno(remitente);
  if (!turno) {
    if (!TURNO_ID && !OBRA) return preguntarObra(remitente, destinatario); // multi-obra: aún sin elegir
    await enviar(destinatario, '⚠️ No encontré un turno activo en monitoreo_turnos. Configúralo en la app.');
    return;
  }

  // Llega FOTO / PDF y el supervisor ya eligió sección → guardar
  if (sesion.paso === 'seccion' && (tipo === 'image' || tipo === 'document')) {
    const mediaMeta = tipo === 'image' ? msg.image : msg.document;
    return guardarEvidencia(remitente, destinatario, sesion, mediaMeta, tipo);
  }

  // Llega TEXTO
  if (esTexto) {
    // Comando "Menu" → reabrir las opciones en cualquier momento
    if (/^(menu|men[uú]|opciones|ver menu)$/i.test(texto)) {
      await enviar(destinatario, textoMenu());
      return;
    }

    // Sección "fuerza de trabajo" espera texto del informe
    if (sesion.paso === 'seccion' && sesion.tipo === 'texto' && texto !== '0') {
      return guardarTextoFuerza(remitente, destinatario, sesion, texto);
    }

    // Atajo "ya subí mis apr" → marcar sin volver a subir la foto
    const marcado = await marcarConfirmacionTexto(remitente, destinatario, texto);
    if (marcado) return;

    // Elige sección 1-12
    const opcion = MENU.find(m => String(m.n) === texto);
    if (opcion) {
      sesiones.set(remitente, { paso: 'seccion', clave: opcion.clave, etiqueta: opcion.etiqueta, tipo: opcion.tipo });
      if (opcion.tipo === 'texto') {
        await enviar(destinatario, `${opcion.etiqueta}\n\nEscribe el informe de fuerza de trabajo (o "0" para cancelar).`);
      } else {
        const pedido = opcion.tipo === 'foto_pdf' ? 'foto o el PDF escaneado' : 'la foto';
        await enviar(destinatario, `${opcion.etiqueta}\n\nSube aquí ${pedido} (o "0" para cancelar).`);
      }
      return;
    }

    if (texto === '0') { sesiones.delete(remitente); await enviar(destinatario, '✅ Sección cancelada. No se guardó nada.'); return; }

    // Menú / ayuda / cualquier otro texto sin sección en curso
    if (sesion.paso !== 'seccion') { await enviar(destinatario, textoMenu()); return; }
    await enviar(destinatario, 'Sigue en el mismo punto: ' + textoMenu());
    return;
  }

  // Llega algo sin haber elegido sección (foto inicial, voz, etc.)
  if (sesion.paso !== 'seccion') { await enviar(destinatario, textoMenu()); }
}

/* ---------------- WEBHOOK (Meta <-> Bot) ---------------- */
// Verificación de Meta (GET)
app.get('/webhook/wa', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Mensajes de Meta (POST)
app.post('/webhook/wa', (req, res) => {
  console.log('POST /webhook/wa RECIBIDO:', JSON.stringify(req.body || {}).slice(0, 1000));
  res.sendStatus(200); // responde de inmediato para no reenviar
  try {
    const body = req.body;
    const value = body && body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value;
    if (value && value.messages) {
      for (const msg of value.messages) {
        console.log(`Mensaje recibido de ${msg.from || '?'} tipo ${msg.type || '?'}`);
        procesar(value, msg).catch(err => console.error('procesar:', err.message));
      }
    }
  } catch (ex) { console.error('webhook:', ex.message); }
});

// Webhook de Zernio (PROVEEDOR=zernio). Sin GET de verificación: Zernio no lo exige.
// Firma HMAC-SHA256 (X-Zernio-Signature) con el secret que definas.
app.post('/webhook/zernio', (req, res) => {
  console.log('POST /webhook/zernio RECIBIDO:', JSON.stringify(req.body || {}).slice(0, 1000));
  if (!firmaValida(req.rawBody, req.headers['x-zernio-signature'])) {
    console.error('zernio: firma inválida');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // 2xx inmediato para que no reintente
  try {
    const ev = req.body || {};
    if (ev.event !== 'message.received') return;
    if (ev.id) {
      if (vistos.has(ev.id)) return; // "al menos una vez" → dedupe
      vistos.add(ev.id);
      if (vistos.size > 500) vistos.delete(vistos.values().next().value);
    }
    const m = ev.message || {};
    const senderId = (m.sender && m.sender.id) || '';
    const conversationId = (ev.conversation && ev.conversation.id) || m.conversationId || '';
    const accountId = (ev.account && ev.account.accountId) || m.accountId || '';
    if (!senderId || !conversationId || !accountId) return;
    recordarCanal(senderId, conversationId, accountId);
    if (ev.metadata && ev.metadata.standby) return; // lo contesta Meta Business Agent
    const atts = m.attachments || [];
    const esTexto = !atts.length;
    const att = atts[0] || {};
    const tipoAtt = (att.type === 'image' || att.type === 'document' || att.type === 'video') ? att.type : null;
    const msg = { from: senderId, type: esTexto ? 'text' : tipoAtt || 'text' };
    if (esTexto) {
      msg.text = { body: m.text || '' };
    } else if (tipoAtt) {
      const mime = att.mimeType || (tipoAtt === 'image' ? 'image/jpeg' : tipoAtt === 'document' ? 'application/pdf' : 'video/mp4');
      msg[tipoAtt] = { id: att.url, url: att.url, mime_type: mime };
    }
    console.log(`Mensaje Zernio recibido de ${senderId} tipo ${msg.type}`);
    procesar({}, msg).catch(err => console.error('procesar:', err.message));
  } catch (ex) { console.error('webhook zernio:', ex.message); }
});

app.get('/', (req, res) => res.send('Bot whatsapp SSMA activo. v3'));
 app.get('/privacidad', (req, res) => {
   res.send('<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Política de Privacidad</title></head><body style="font-family:Arial,sans-serif;margin:2rem auto;max-width:720px;line-height:1.5"><h1>Política de Privacidad</h1><p><strong>Responsable:</strong> Secury Inovatech.</p><p>El bot de WhatsApp "Reportes de Seguridad Bot" procesa los siguientes datos para operar: número de WhatsApp del remitente, mensajes de texto e imágenes que el usuario envía voluntariamente como evidencia de los recorridos de seguridad, y la obra o sección seleccionada por el usuario.</p><p>Estos datos se utilizan únicamente para registrar y dar seguimiento a los reportes de seguridad solicitados, se almacenan en una base de datos segura y no se comparten con terceros, salvo obligación legal.</p><p>El usuario puede solicitar la corrección o eliminación de sus datos escribiendo al mismo número de WhatsApp del bot.</p><p><em>Última actualización: 28/09/2026.</em></p></body></html>');
 });
 const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot activo en el puerto ${PORT}`));