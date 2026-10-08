// ============================================================
//  CORREOS DEL BOT DE VENTAS - SECURY INOVATECH
//
//  Envía por SMTP (nodemailer):
//     'agendada'    -> cuando el prospecto agenda el horario
//     'confirmada'  -> cuando el asesor responde SI
//     'recordatorio'-> 1 hora antes de la cita
//
//  Si no hay SMTP configurado no truena: solo avisa en el log
//  y el bot sigue funcionando por WhatsApp.
//
//  debug/pruebas: SMTP_STUB=true arma el mensaje sin conectarse.
// ============================================================

const nodemailer = require('nodemailer');

const EMPRESA = process.env.EMPRESA_NOMBRE || 'SECURY INOVATECH';
const OFFSET = process.env.DEMO_UTC_OFFSET || '-06:00';

let transporte = null;
let de = { name: EMPRESA, address: '' };
let modoStub = false;
// Copia oculta (BCC) de cada correo al asesor (opcional)
let bccCorreo = String(process.env.ASESOR_EMAIL || '').trim() || null;

function init() {
  bccCorreo = String(process.env.ASESOR_EMAIL || '').trim() || null;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (String(process.env.SMTP_STUB || '') === 'true') {
    modoStub = true;
    return;
  }
  if (!host || !user || !pass) {
    console.error('correo: SMTP no configurado (SMTP_HOST/SMTP_USER/SMTP_PASS). No se enviarán correos.');
    transporte = null;
    return;
  }
  try {
    const port = Number(process.env.SMTP_PORT || 465);
    transporte = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: { user: user, pass: pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000
    });
    de = { name: EMPRESA, address: process.env.EMAIL_DE || user };
    console.log(`correo: SMTP listo -> ${host}:${port} (BCC ${bccCorreo || 'sin copia'})`);
  } catch (e) {
    console.error('correo:', e.message);
    transporte = null;
  }
}

function fechaLegible(fecha, hora) {
  try {
    const d = new Date(`${fecha}T12:00:00${OFFSET}`);
    return `${d.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long' })} · ${hora} h`;
  } catch (e) {
    return `${fecha} ${hora}`;
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function build(p, tipo, extra) {
  const e = extra || {};
  const nombre = esc((p && p.nombre || '').split(' ')[0]);
  const f = (e.fecha && e.hora) ? fechaLegible(e.fecha, e.hora) : '';
  const logo = `*${EMPRESA}*`;
  const firmas = {
    agendada: [
      `Hola ${nombre || '👋'},`,
      `Agendamos una <b>cita demo</b> de ~30 minutos${f ? ' para el <b>' + f + '</b>' : ''}.`,
      'Te conectamos por videollamada (te mandamos el enlace 10 minutos antes por este mismo WhatsApp).',
      'Un asesor revisará tu caso y te dejará la propuesta con tus precios.',
      '— ' + logo
    ],
    confirmada: [
      `Hola ${nombre || '👋'},`,
      '¡Tu cita demo fue <b>confirmada</b>!' + (f ? ` Te esperamos el <b>${f}</b>.` : ''),
      'Te escribimos 10 minutos antes por este mismo WhatsApp con el enlace de la videollamada.',
      '— ' + logo
    ],
    recordatorio: [
      `Hola ${nombre || '👋'},`,
      `Tu cita demo${f ? ' es <b>hoy</b> a las <b>' + f + '</b>' : ' ya casi es la hora'}.`,
      'Revisa el enlace que te mandamos por WhatsApp. Si necesitas reagendar, escríbenos por el mismo chat.',
      '— ' + logo
    ]
  };
  const g = firmas[tipo] || firmas.agendada;
  const titulos = {
    agendada: '🗓️ Tu cita demo está agendada',
    confirmada: '✅ Tu cita quedó confirmada',
    recordatorio: '⏰ Recordatorio de tu cita demo'
  };
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px;margin:0 auto">' +
    '<h2 style="color:#0f766e">' + (titulos[tipo] || titulos.agendada) + '</h2>' +
    g.map(l => '<p style="margin:.6em 0;line-height:1.5">' + l + '</p>').join('') +
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:1.2em 0">' +
    '<p style="color:#6b7280;font-size:.82em">Mensaje automático de ' + esc(EMPRESA) + ' · ' + (p && p.wa_id ? ('WhatsApp ' + p.wa_id) : '') + '</p>' +
    '</div>';
  return { asunto: (titulos[tipo] || titulos.agendada) + ' — ' + EMPRESA, html: html };
}

async function enviar(p, tipo, extra) {
  if (!p || !p.correo) return;
  if (!transporte && !modoStub) return;
  const mensaje = build(p, tipo, extra);
  try {
    if (modoStub) {
      console.log('correo [stub ' + tipo + '] -> ' + p.correo +
        (bccCorreo ? ' + copia ' + bccCorreo : '') + ' · ' + mensaje.asunto);
      return;
    }
    const info = await transporte.sendMail({
      from: (de.name ? `"${de.name}" <${de.address || ''}>` : de.address),
      to: p.correo,
      bcc: bccCorreo || undefined, // copia oculta al asesor
      subject: mensaje.asunto,
      html: mensaje.html
    });
    console.log(`correo [${tipo}] -> ${p.correo}` +
      (bccCorreo ? ' (copia ' + bccCorreo + ')' : '') + ` (${info.messageId})`);
  } catch (e) {
    console.error('correo: no se pudo enviar [' + tipo + '] a ' + p.correo + ':', e.message);
  }
}

module.exports = { init, enviar, build, fechaLegible };