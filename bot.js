// ============================================================
//  BOT WHATSAPP — MONITOREO DE TURNO (grupo)
//  Recibe fotos/PDF del supervisor, pregunta sección 1-12,
//  sube la evidencia a Supabase (bucket "media") y registra en
//  monitoreo_envios, respondiendo con el avance del turno.
// ------------------------------------------------------------
//  Requiere Node 18+ (instala: https://nodejs.org)
//  Instalación local (una vez):   npm install
//  Correr localmente:             npm start
//  Desplegar en nube 24/7:        Render / Railway / Fly.io
// ============================================================

require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

/* ---------------- CONFIGURACIÓN (se carga desde .env) ---------------- */
const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v19.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mi-token-de-verificacion';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ID del turno en la tabla monitoreo_turnos (mira en Supabase Table Editor).
// Si lo dejas vacío, el bot usa OBRA (o el primer turno activo).
const TURNO_ID = process.env.TURNO_ID ? Number(process.env.TURNO_ID) : null;
const OBRA = process.env.OBRA || '';

if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Faltan variables de entorno. Revisa tu archivo .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const app = express();
app.use(express.json({ limit: '15mb' }));

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

// Estado en memoria por remitente: { paso: 'obra' | 'seccion', clave, etiqueta, tipo, obraTs }
//  - paso 'obra': está eligiendo su obra (multi-obra)
//  - paso 'seccion': eligió sección del menú y espera su evidencia
const sesiones = new Map();

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
  return '📋 ¿De qué sección? Responde:\n\n' +
    MENU.map(m => `${m.n}) ${m.etiqueta}`).join('\n') +
    '\n\n(Manda "0" para cancelar la sección en curso.)';
}

async function enviar(destinatario, body) {
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

async function descargarMedia(mediaId) {
  const r1 = await fetch(`${GRAPH_URL}/${mediaId}`, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
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
    const { buffer, mime } = await descargarMedia(mediaMeta.id);
    // Subir al bucket "media" (la misma ruta que usa la app)
    const esPdf = mime === 'application/pdf' || (mediaMeta.mime_type || '').includes('pdf');
    const ext = esPdf ? 'pdf' : 'jpg';
    const tipo = esPdf ? 'pdf' : 'foto';
    const usuario = await buscarUsuario(remitente);
    const userId = usuario ? usuario.id : uuidDeRemitente(remitente);
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
      nombre: (usuario && usuario.nombre) || 'Supervisor (WhatsApp)',
      texto: '',
      media: mediaJson
    });
    if (errIns) throw errIns;

    const { hecho, total, pct } = await calcularAvance(turno, userId, seccion.clave);
    const obra = turno.obra || 'la obra';
    await enviar(destinatario,
      `✅ ${seccion.etiqueta}, registrado en '${obra}' a las ${horaLocal()}.\n` +
      `Avance ${hecho}/${total} formularios. ${comentario(pct)}`);
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
    const usuario = await buscarUsuario(remitente);
    const userId = usuario ? usuario.id : uuidDeRemitente(remitente);
    const { error } = await supabase.from('monitoreo_envios').insert({
      turno_id: turno.id, fecha: hoy(), form_clave: seccion.clave,
      user_id: userId, nombre: (usuario && usuario.nombre) || 'Supervisor (WhatsApp)',
      texto, media: []
    });
    if (error) throw error;
    const { hecho, total, pct } = await calcularAvance(turno, userId, seccion.clave);
    const obra = turno.obra || 'la obra';
    await enviar(destinatario,
      `✅ ${seccion.etiqueta}, registrado en '${obra}' a las ${horaLocal()}.\n` +
      `Avance ${hecho}/${total} formularios. ${comentario(pct)}`);
  } catch (ex) {
    console.error('guardarTextoFuerza:', ex.message);
    await enviar(destinatario, '⚠️ Ocurrió un error al guardar. Inténtalo de nuevo.');
  } finally {
    sesiones.delete(remitente);
  }
}

/* ---------------- PROCESAR MENSAJES ---------------- */
async function procesar(val, msg) {
  const remitente = msg.from;
  const destinatario = (msg.context && msg.context.group_id) || remitente; // grupo o DM
  const tipo = msg.type;
  const esTexto = tipo === 'text';
  const texto = esTexto ? ((msg.text && msg.text.body) || '').trim() : '';
  const sesion = sesiones.get(remitente) || {};

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
    // Sección "fuerza de trabajo" espera texto del informe
    if (sesion.paso === 'seccion' && sesion.tipo === 'texto' && texto !== '0') {
      return guardarTextoFuerza(remitente, destinatario, sesion, texto);
    }

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

app.get('/', (req, res) => res.send('Bot whatsapp SSMA activo. v2'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot activo en el puerto ${PORT}`));