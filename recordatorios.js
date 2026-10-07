// ============================================================
//  RECORDATORIOS DE CITAS 1 HORA ANTES (WhatsApp + correo)
//
//  Cada minuto el bot pregunta por citas confirmadas
//  ('cita_confirmada') que no han recibido recordatorio
//  (recordado_1h=false) y cuya cita falta <= RECORDAR_ANTES_MIN.
// ============================================================

const OFFSET = process.env.DEMO_UTC_OFFSET || '-06:00';
const EMPRESA = process.env.EMPRESA_NOMBRE || 'SECURY INOVATECH';

function msCita(fecha, hora) {
  return Date.parse(`${fecha}T${hora}:00${OFFSET}`) || NaN;
}

function fechaBonita(fecha, hora) {
  try {
    const d = new Date(`${fecha}T12:00:00${OFFSET}`);
    return `${d.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'short' })} · ${hora} h`;
  } catch (e) {
    return `${fecha} ${hora}`;
  }
}

function textoRecordatorio(p, slot) {
  const nombre = (p.nombre || '').split(' ')[0];
  return (nombre ? `Hola ${nombre}, ` : '') +
    '⏰ *Recordatorio de tu cita demo* 🔔\n\n' +
    `Tu cita con *${EMPRESA}* es hoy:\n\n` +
    `🗓️ *${fechaBonita(slot.fecha, slot.hora)}*\n\n` +
    'Te esperamos 😊. Si necesitas reagendar o cancelar, escribe *menu* y uno de nosotros te apoya.';
}

// Devuelve cuántos recordatorios mandó.
async function revisar(opts) {
  const supabase = opts.supabase;
  if (!supabase) return 0;
  const enviar = opts.enviar;
  const correo = opts.correo;
  const ahora = opts.ahora || Date.now();
  const ventanaMin = Number(opts.ventanaMin || process.env.RECORDAR_ANTES_MIN || 60);

  const { data, error } = await supabase
    .from('prospectos')
    .select('id, nombre, wa_id, correo, slot_id')
    .eq('etapa', 'cita_confirmada')
    .eq('recordado_1h', false)
    .limit(200);
  if (error) { console.error('recordatorios:', error.message); return 0; }

  let n = 0;
  for (const p of data || []) {
    try {
      if (!p.slot_id || !p.correo || !p.wa_id) continue;
      const { data: slot } = await supabase
        .from('demo_slots').select('fecha, hora').eq('id', p.slot_id).maybeSingle();
      if (!slot) continue;
      const diff = msCita(slot.fecha, slot.hora) - ahora;
      // dentro de la ventana (y tolerancia de 5 min si el job se atrasa)
      if (diff > ventanaMin * 60000 || diff < -5 * 60000) continue;
      if (enviar) await enviar(p.wa_id, textoRecordatorio(p, slot));
      if (correo) await correo(p, 'recordatorio', { fecha: slot.fecha, hora: slot.hora });
      await supabase.from('prospectos').update({ recordado_1h: true }).eq('id', p.id);
      n++;
    } catch (e) {
      console.error('recordatorios:', e.message);
    }
  }
  return n;
}

module.exports = { revisar, msCita, fechaBonita, textoRecordatorio };