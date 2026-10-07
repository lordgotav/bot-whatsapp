// ============================================================
//  EMBUDO DE PROSPECTOS - Bot SECURY INOVATECH
//
//  Serie de preguntas que saca un SCORE (0-100) y agenda una
//  cita demo. Todo se guarda en Supabase:
//     prospectos           -> una fila por numero de WhatsApp
//     prospecto_respuestas -> bitacora de cada respuesta
//     demo_slots           -> horarios disponibles
//
//  Bandas:  >=70 caliente | 40-69 tibio | <40 frio
//  El umbral para ofrecer cita esta en DEMO_UMBRAL (.env).
// ============================================================

const EMPRESA = process.env.EMPRESA_NOMBRE || 'SECURY INOVATECH';
const ASESOR_WA = (process.env.ASESOR_WA || '').replace(/\D/g, '');
const DEMO_UMBRAL = Number(process.env.DEMO_UMBRAL || 40);
const AVISAR_TIBIOS = String(process.env.AVISAR_TIBIOS || 'false').toLowerCase() === 'true';
const DEMO_UTC_OFFSET = process.env.DEMO_UTC_OFFSET || '-06:00';

let supabase = null;
let enviar = null;
const avisados = new Set(); // wa:fecha -> ya se le aviso al asesor hoy

function init(cfg) {
  supabase = cfg.supabase;
  enviar = cfg.enviar;
}

function norma(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function hoy() { return new Date().toISOString().slice(0, 10); }

/* ------------------------- PREGUNTAS ------------------------- */

const CARGOS = [
  { t: 'Dueño / Director / Gerente', p: 20 },
  { t: 'Responsable SST / HSE / Medio Ambiente', p: 18 },
  { t: 'Supervisor / Jefe de obra', p: 15 },
  { t: 'Coordinador / Administrativo', p: 10 },
  { t: 'Otro', p: 5 }
];

const TRABAJADORES = [
  { t: 'Menos de 5', p: 3 },
  { t: '5 a 19', p: 6 },
  { t: '20 a 49', p: 10 },
  { t: '50 a 99', p: 13 },
  { t: '100 o más', p: 15 }
];

const OBRAS = [
  { t: '1 obra o centro de trabajo', p: 5 },
  { t: '2 obras', p: 9 },
  { t: '3 u 4 obras', p: 13 },
  { t: '5 o más obras', p: 15 }
];

const PROCESO = [
  { t: 'Papel, Excel o bitácoras físicas', p: 20 },
  { t: 'WhatsApp y Excel, sin sistema', p: 18 },
  { t: 'Otra plataforma o software', p: 10 },
  { t: 'Ya lo tengo en un sistema propio', p: 6 }
];

const CUMPLIMIENTO = [
  { t: 'Lo llevamos en papel y se nos desordena', p: 10 },
  { t: 'Cumplimos, pero sin evidencia ordenada', p: 8 },
  { t: 'Sí, con sistema y evidencias en orden', p: 4 }
];

const INTERESES_APP = [
  'Reportes de actos y condiciones inseguras',
  'Archivo diario: permisos de trabajo y check lists',
  'Monitoreo de turno con evidencias',
  'Módulos SSMA (accidentes, auditorías, capacitaciones…)',
  'Tablero, contador de días sin accidentes y exportar Excel'
];

// Devuelve la lista de pasos del embudo segun el servicio elegido
function pasosDe(servicioClave) {
  const esApp = !servicioClave || servicioClave === 'app';
  const pasos = [
    {
      clave: 'nombre',
      tipo: 'texto',
      titulo: '¿Cuál es tu nombre?',
      hint: 'Escríbeme tu nombre completo.',
      aplicar: t => ({ campos: { nombre: t }, puntos: 0 })
    },
    {
      clave: 'empresa',
      tipo: 'texto',
      titulo: '¿De qué empresa eres y en qué ciudad?',
      hint: 'Ej. *Constructora XYZ, Monterrey*',
      aplicar: t => {
        const partes = t.split(',');
        return { campos: { empresa: partes[0].trim(), ciudad: (partes[1] || '').trim() || null }, puntos: 0 };
      }
    },
    {
      clave: 'cargo', tipo: 'opciones', titulo: '¿Cuál es tu cargo?',
      opciones: CARGOS,
      aplicar: (op) => ({ campos: { cargo: op.t }, puntos: op.p })
    },
    {
      clave: 'trabajadores', tipo: 'opciones', titulo: '¿Cuántos trabajadores tienen en campo?',
      opciones: TRABAJADORES,
      aplicar: (op) => ({ campos: { trabajadores: op.t }, puntos: op.p })
    },
    {
      clave: 'obras', tipo: 'opciones', titulo: '¿Cuántas obras o centros de trabajo administran?',
      opciones: OBRAS,
      aplicar: (op) => ({ campos: { obras: op.t }, puntos: op.p })
    },
    {
      clave: 'proceso', tipo: 'opciones',
      titulo: '¿Cómo llevan hoy sus registros de seguridad?',
      opciones: PROCESO,
      aplicar: (op) => ({ campos: { proceso: op.t }, puntos: op.p })
    },
    {
      clave: 'cumplimiento', tipo: 'opciones',
      titulo: '¿Cómo van con el cumplimiento (STPS, cliente, auditorías)?',
      opciones: CUMPLIMIENTO,
      aplicar: (op) => ({ campos: { cumplimiento: op.t }, puntos: op.p })
    }
  ];

  if (esApp) {
    pasos.push({
      clave: 'intereses', tipo: 'multi',
      titulo: '¿Qué te interesa de la plataforma?',
      instruccion: 'Puedes elegir varios: escribe *1 3 4* o *todas*.',
      opciones: INTERESES_APP.map((t, i) => ({ t, p: 0 })),
      aplicar: (ops) => ({
        campos: { intereses: ops.map(o => o.t) },
        puntos: ops.length >= 3 ? 10 : 5
      })
    });
  } else {
    pasos.push({
      clave: 'necesidad', tipo: 'texto',
      titulo: '¿Qué necesitas exactamente?',
      hint: 'Cuéntame en una línea qué quieres resolver.',
      aplicar: t => ({ campos: { intereses: [t] }, puntos: t.length >= 20 ? 10 : 5 })
    });
  }

  pasos.push(
    {
      clave: 'correo', tipo: 'texto',
      titulo: '¿A qué correo te mandamos la propuesta?',
      hint: 'Escribe tu correo, o *no* si prefieres no dejarlo.',
      aplicar: t => {
        if (/^(no|ninguno|saltar|prefiero no)$/i.test(t.trim())) return { campos: { correo: null }, puntos: 0 };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.trim())) return null; // no valida -> se repite
        return { campos: { correo: t.trim() }, puntos: 5 };
      }
    },
    {
      clave: 'autoriza', tipo: 'opciones',
      titulo: '¿Agendamos una cita demo?',
      instruccion: 'Son ~30 minutos donde te enseño la plataforma y te dejo una propuesta.',
      opciones: [
        { t: 'Sí, agéndame la demo', p: 5 },
        { t: 'Prefiero que me escriban después', p: 0 }
      ],
      aplicar: (op) => ({ campos: { autoriza_demo: op.p === 5 }, puntos: op.p, salto: op.p === 5 ? 'slot' : 'fin_sin_cita' })
    }
  );

  return pasos;
}

/* ------------------------- RENDER ------------------------- */

function textoOpciones(paso) {
  const lista = paso.opciones.map((o, i) => `${i + 1}) ${o.t}`).join('\n');
  return `*${paso.titulo}*\n\n${lista}` +
    (paso.instruccion ? `\n\n${paso.instruccion}` : '\n\nResponde con el *número*.');
}

function textoPaso(paso) {
  if (paso.tipo === 'texto') {
    return `*${paso.titulo}*\n\n${paso.hint || ''}`.trim();
  }
  return textoOpciones(paso);
}

function parseNums(texto, total, multi) {
  const m = String(texto || '').match(/\d+/g);
  if (!m) return null;
  let nums = [...new Set(m.map(Number))].filter(n => n >= 1 && n <= total);
  if (!nums.length) return null;
  if (!multi) nums = [nums[0]];
  if (multi && /(^|\s)(todas|todo|todo(s)?|ambas)(\s|$)/i.test(texto)) nums = total ? Array.from({ length: total }, (_, i) => i + 1) : nums;
  return nums;
}

/* ------------------------- SCORE ------------------------- */

function calcularBanda(score) {
  if (score >= 70) return 'caliente';
  if (score >= DEMO_UMBRAL) return 'tibio';
  return 'frio';
}

const EMOJI_BANDA = { caliente: '🔥 CALIENTE', tibio: '🌤 Tibio', frio: '❄️ Frío', nuevo: '🆕 Nuevo' };

/* ------------------------- PASOS / GUARDADO ------------------------- */

function pasoPorClave(clave, servicioClave) {
  return pasosDe(servicioClave).find(p => p.clave === clave) || null;
}

function siguientePaso(clave, servicioClave) {
  const lista = pasosDe(servicioClave);
  const i = lista.findIndex(p => p.clave === clave);
  return i >= 0 && i + 1 < lista.length ? lista[i + 1] : null;
}

async function guardarRespuesta(prospecto, paso, textoRespuesta, puntos) {
  if (!prospecto || !prospecto.id) return;
  try {
    await supabase.from('prospecto_respuestas').insert({
      prospecto_id: prospecto.id,
      paso: paso.clave,
      pregunta: paso.titulo,
      respuesta: String(textoRespuesta || '').slice(0, 500),
      puntos: puntos || 0
    });
  } catch (e) { console.error('embudo.guardarRespuesta:', e.message); }
}

async function guardarProspecto(waId, campos, score, etapa) {
  const fila = Object.assign(
    { wa_id: waId, updated_at: new Date().toISOString() },
    campos || {},
    score !== undefined ? { score: score, banda: calcularBanda(score) } : {},
    etapa ? { etapa: etapa } : {}
  );
  try {
    const { data, error } = await supabase
      .from('prospectos')
      .upsert(fila, { onConflict: 'wa_id' })
      .select('*')
      .maybeSingle();
    if (error) { console.error('embudo.guardarProspecto:', error.message); return null; }
    return data;
  } catch (e) { console.error('embudo.guardarProspecto:', e.message); return null; }
}

async function leerProspecto(waId) {
  try {
    const { data } = await supabase.from('prospectos').select('*').eq('wa_id', waId).maybeSingle();
    return data || null;
  } catch (e) { console.error('embudo.leerProspecto:', e.message); return null; }
}

/* ------------------------- INICIO / REANUDAR ------------------------- */

// Arranca el embudo (o lo reanuda si ya avanzo antes de un redeploy)
async function iniciar({ waId, destinatario, servicio }) {
  let p = await leerProspecto(waId);
  const etapa = p && p.etapa ? p.etapa : 'inicio';

  if (p && (etapa === 'cita_agendada' || etapa === 'cerrado' || etapa === 'seguimiento')) {
    await enviar(destinatario, yaParticipo(p));
    return { salir: true };
  }

  const pasos = pasosDe(servicio && servicio.clave);
  let clave = 'nombre';
  let score = 0;

  if (p && etapa !== 'inicio') {
    // Reanuda en el paso siguiente al ultimo guardado
    const ultima = await ultimaRespuesta(p.id);
    const i = pasos.findIndex(x => x.clave === ultima);
    clave = (i >= 0 && i + 1 < pasos.length) ? pasos[i + 1].clave : 'nombre';
    score = p.score || 0;
    if (p.nombre) await enviar(destinatario, `↩️ Retomamos donde quedamos, ${String(p.nombre).split(' ')[0]}. 👇`);
  } else {
    p = await guardarProspecto(waId, { servicio: servicio && servicio.clave, etapa: 'encuesta' }, 0, 'encuesta');
    await enviar(destinatario,
      `📝 *Perfecto, son solo 8 preguntas (1 minuto)*\n\n` +
      `Con esto te preparo una propuesta a tu medida y, si quieres, *te agendo una cita demo*.\n\n` +
      `Empezamos 👇`);
  }

  if (!p) p = await leerProspecto(waId);
  const paso = pasoPorClave(clave, servicio && servicio.clave);
  await enviar(destinatario, textoPaso(paso));
  return { paso: paso.clave, servicioClave: servicio && servicio.clave, servicioTitulo: servicio && servicio.titulo, score: score };
}

async function ultimaRespuesta(prospectoId) {
  try {
    const { data } = await supabase
      .from('prospecto_respuestas')
      .select('paso')
      .eq('prospecto_id', prospectoId)
      .order('id', { ascending: false })
      .limit(1);
    return data && data[0] ? data[0].paso : null;
  } catch (e) { return null; }
}

function yaParticipo(p) {
  if (p.etapa === 'cita_agendada') {
    return `✅ *Ya tienes una cita agenda, ${String(p.nombre || '').split(' ')[0] || 'amigo'}:*\n\n` +
      `· Score: ${p.score}/100 (${EMOJI_BANDA[p.banda] || p.banda})\n` +
      `· Un asesor te confirma por este mismo WhatsApp.\n\n` +
      `Escribe *menu* para ver otros servicios.`;
  }
  return `✅ Ya dejaste tus datos, ${String(p.nombre || '').split(' ')[0] || 'amigo'} (score ${p.score}/100).\n\n` +
    `Un asesor de ${EMPRESA} te contactará. Escribe *menu* para ver otros servicios.`;
}

/* ------------------------- PROCESO ------------------------- */

// Devuelve true si consumo el mensaje
async function procesar({ waId, destinatario, texto, sesion }) {
  const servicioClave = sesion.servicioClave || 'app';
  const t = String(texto || '').trim();

  // "0" cancela el embudo
  if (t === '0') {
    await guardarProspecto(waId, {}, undefined, 'abandonado');
    await enviar(destinatario, '❎ Encuesta cancelada. Escribe *menu* para ver los servicios.');
    return { salir: true };
  }

  // --- Estaba pidiendo elegir horario de la cita ---
  if (sesion.embudoSlot) {
    if (!/^\d+$/.test(t)) {
      await enviar(destinatario, 'Escribe el *número* del horario que prefieres.');
      return true;
    }
    return agendarSlot(waId, destinatario, sesion, Number(t), sesion.score || 0);
  }

  const paso = pasoPorClave(sesion.embudoPaso, servicioClave);
  if (!paso) return false;

  const pasoActual = paso;

  /* --- opciones (1..n) --- */
  if (pasoActual.tipo === 'opciones' || pasoActual.tipo === 'multi') {
    const nums = parseNums(t, pasoActual.opciones.length, pasoActual.tipo === 'multi');
    if (!nums) {
      await enviar(destinatario, `Respuesta no válida.\n\n${textoOpciones(pasoActual)}`);
      return true;
    }
    const ops = nums.map(n => pasoActual.opciones[n - 1]);
    // Los pasos de una sola opcion esperan el objeto; "multi" espera la lista
    const r = pasoActual.aplicar(pasoActual.tipo === 'multi' ? ops : ops[0]);
    const p = await leerProspecto(waId);
    const score = Math.min(100, ((p && p.score) || 0) + (r.puntos || 0));
    await guardarRespuesta(p || { id: null }, pasoActual, ops.map(o => o.t).join(', '), r.puntos);
    await guardarProspecto(waId, Object.assign({ etapa: 'encuesta' }, r.campos), score, 'encuesta');

    if (r.salto === 'slot') return ofrecerSlots(waId, destinatario, sesion, score);
    if (r.salto === 'fin_sin_cita') return cerrar(waId, destinatario, sesion, score, false);

    const sig = siguientePaso(pasoActual.clave, servicioClave);
    if (!sig) return cerrar(waId, destinatario, sesion, score, false);
    await enviar(destinatario, textoPaso(sig));
    return { paso: sig.clave, score: score };
  }

  /* --- texto libre --- */
  const r = pasoActual.aplicar(t);
  if (r === null) {
    await enviar(destinatario, `Eso no parece válido.\n\n${textoPaso(pasoActual)}`);
    return true;
  }
  const p = await leerProspecto(waId);
  const score = Math.min(100, ((p && p.score) || 0) + (r.puntos || 0));
  await guardarRespuesta(p || { id: null }, pasoActual, t, r.puntos);
  await guardarProspecto(waId, Object.assign({ etapa: 'encuesta' }, r.campos), score, 'encuesta');

  const sig = siguientePaso(pasoActual.clave, servicioClave);
  if (!sig) return cerrar(waId, destinatario, sesion, score, false);
  await enviar(destinatario, textoPaso(sig));
  return { paso: sig.clave, score: score };
}

/* ------------------------- SLOTS / CITA ------------------------- */

async function slotsDisponibles(cantidad) {
  try {
    if (supabase.rpc) await supabase.rpc('refill_demo_slots', { p_dias: 14 });
  } catch (e) { console.error('embudo.refill:', e.message); }

  try {
    const { data, error } = await supabase
      .from('demo_slots')
      .select('id, fecha, hora')
      .eq('disponible', true)
      .gte('fecha', hoy())
      .order('fecha', { ascending: true })
      .order('hora', { ascending: true })
      .limit(40);
    if (error) { console.error('embudo.slots:', error.message); return []; }

    const ahora = Date.now();
    return (data || []).filter(s => {
      // fecha+hora en la zona local configurada; descarta los que ya pasaron
      const dt = new Date(`${s.fecha}T${s.hora}:00${DEMO_UTC_OFFSET}`).getTime();
      return dt > ahora + 30 * 60 * 1000; // al menos 30 min de anticipacion
    }).slice(0, cantidad || 5);
  } catch (e) { console.error('embudo.slots:', e.message); return []; }
}

function fechaBonita(fecha, hora) {
  try {
    const d = new Date(`${fecha}T12:00:00${DEMO_UTC_OFFSET}`);
    const dia = d.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'short' });
    return `${dia} · ${hora} h`;
  } catch (e) { return `${fecha} ${hora}`; }
}

async function ofrecerSlots(waId, destinatario, sesion, score) {
  const slots = await slotsDisponibles(5);
  if (!slots.length) {
    await enviar(destinatario,
      '😔 Por ahora no tengo horarios libres esta semana.\n\n' +
      'Déjame tu WhatsApp y un asesor te escribe para agendar (escribe *menu* para continuar).');
    await guardarProspecto(waId, {}, score, 'seguimiento');
    return { salir: true };
  }
  sesion.slots = slots;
  const lista = slots.map((s, i) => `${i + 1}) 📅 ${fechaBonita(s.fecha, s.hora)}`).join('\n');
  await enviar(destinatario,
    `🗓️ *Elige el horario de tu cita demo* (~30 min, por videollamada o presencial):\n\n${lista}\n\n` +
    `Responde con el *número*.`);
  return { paso: 'slot', score: score };
}

async function agendarSlot(waId, destinatario, sesion, n, score) {
  const slots = sesion.slots || [];
  const slot = slots[n - 1];
  if (!slot) {
    if (!slots.length) return ofrecerSlots(waId, destinatario, sesion, score); // se perdió la lista (redeploy)
    await enviar(destinatario, `Número inválido. Elige entre 1 y ${slots.length}.`);
    return true;
  }
  const p = await leerProspecto(waId);
  const { data: upd, error } = await supabase
    .from('demo_slots')
    .update({ disponible: false, ocupado_por: p ? p.id : null, motivo: 'demo' })
    .eq('id', slot.id)
    .eq('disponible', true)
    .select('id')
    .maybeSingle();

  if (error || !upd) {
    await enviar(destinatario, 'Ese horario ya se ocupó 😅. Elige otro:');
    return ofrecerSlots(waId, destinatario, sesion, score);
  }

  await guardarProspecto(waId, { slot_id: slot.id }, score, 'cita_agendada');
  const p2 = await leerProspecto(waId);
  await cerrar(waId, destinatario, sesion, score, true, slot);
  await avisarAsesor(p2, sesion);
  return { salir: true };
}

/* ------------------------- CIERRE ------------------------- */

async function cerrar(waId, destinatario, sesion, score, conCita, slot) {
  const p = await leerProspecto(waId);
  const nombre = p && p.nombre ? String(p.nombre).split(' ')[0] : '';
  const banda = calcularBanda(score);
  const etapa = conCita ? 'cita_agendada' : 'seguimiento';
  await guardarProspecto(waId, {}, score, etapa);

  let m = `🎉 *Listo${nombre ? ' ' + nombre : ''}, ¡gracias!*\n\n` +
    `📊 Tu puntaje: *${score}/100* — ${EMOJI_BANDA[banda]}\n\n`;

  if (p) {
    m += '*Tu resumen:*\n' +
      `· Empresa: ${p.empresa || '—'}${p.ciudad ? ', ' + p.ciudad : ''}\n` +
      `· Cargo: ${p.cargo || '—'}\n` +
      `· Personal: ${p.trabajadores || '—'} · Obras: ${p.obras || '—'}\n` +
      `· Registros hoy: ${p.proceso || '—'}\n` +
      `· Servicio: ${sesion.servicioTitulo || p.servicio || '—'}\n\n`;
  }

  if (conCita && slot) {
    m += `🗓️ *Cita demo agendada:* ${fechaBonita(slot.fecha, slot.hora)}\n\n` +
      `*¿Qué sigue?*\n` +
      `1️⃣ Demo guiada de ~30 min\n` +
      `2️⃣ *Trial de 15 días* con tus datos reales\n` +
      `3️⃣ Tu app lista en *1 día a 1 semana* (contrato, plan y anticipo)\n\n`;
  } else {
    m += `👤 Un asesor de ${EMPRESA} te contactará por este mismo WhatsApp para ayudarte.\n\n`;
  }

  m += `Escribe *menu* para ver otros servicios.`;
  await enviar(destinatario, m);
  return { salir: true };
}

/* ------------------------- AVISO AL ASESOR ------------------------- */

async function avisarAsesor(p, sesion) {
  if (!ASESOR_WA || !p) return;
  const banda = p.banda || calcularBanda(p.score || 0);
  if (banda !== 'caliente' && !(AVISAR_TIBIOS && banda === 'tibio')) return;
  if (p.notas === 'avizado') return;
  const clave = `${p.wa_id}:${hoy()}`;
  if (avisados.has(clave)) return;
  avisados.add(clave);

  const slot = p.slot_id ? await leerSlot(p.slot_id) : null;
  const m =
    `🔔 *NUEVO PROSPECTO ${banda === 'caliente' ? 'CALIENTE' : 'TIBIO'}* — ${EMPRESA}\n\n` +
    `👤 ${p.nombre || '—'}\n` +
    `🏢 ${p.empresa || '—'}${p.ciudad ? ', ' + p.ciudad : ''}\n` +
    `💼 ${p.cargo || '—'}\n` +
    `👷 ${p.trabajadores || '—'} trabajadores · ${p.obras || '—'}\n` +
    `📊 Proceso actual: ${p.proceso || '—'}\n` +
    `🧾 Cumplimiento: ${p.cumplimiento || '—'}\n` +
    `✉️ Correo: ${p.correo || '—'}\n` +
    `🎯 Servicio: ${sesion.servicioTitulo || p.servicio || '—'}\n` +
    `⭐ SCORE: *${p.score}/100*\n\n` +
    (slot ? `🗓️ *Cita:* ${fechaBonita(slot.fecha, slot.hora)}\n\n` : '') +
    `📱 WhatsApp: ${p.wa_id}\n\n` +
    `Responde *SI* a este mensaje para confirmarle la cita.`;

  try {
    await enviar(ASESOR_WA, m);
    await supabase.from('prospectos').update({ notas: 'avizado' }).eq('id', p.id);
  } catch (e) { console.error('embudo.avisarAsesor:', e.message); }
}

async function leerSlot(id) {
  try {
    const { data } = await supabase.from('demo_slots').select('fecha, hora').eq('id', id).maybeSingle();
    return data || null;
  } catch (e) { return null; }
}

module.exports = { init, iniciar, procesar, agendarSlot, calcularBanda, pasosDe, textoPaso, DEMO_UMBRAL };
