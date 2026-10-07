// ============================================================
//  TEST del bot de ventas (sin WhatsApp ni Supabase real)
//
//  Corre:   node test-embudo.js
//
//  Monta un Supabase falso en memoria, recorre el menu de
//  servicios, busca en las FAQ y ejecuta el embudo completo
//  hasta agendar la cita y avisar al asesor.
// ============================================================
const assert = require('assert');

process.env.ASESOR_WA = '528331039200';
process.env.DEMO_UMBRAL = '40';
process.env.EMPRESA_NOMBRE = 'SECURY INOVATECH';
process.env.DEMO_UTC_OFFSET = '-06:00';

/* ---------------- Supabase falso en memoria ---------------- */
function crearSupabaseFake() {
  const tablas = {
    servicios_bot: [], prospectos: [], prospecto_respuestas: [],
    demo_slots: [], faq_consultas: []
  };
  let seq = 1;

  function filtrar(rows, filtros) {
    return rows.filter(r => filtros.every(([op, c, v]) => {
      if (op === 'eq') return r[c] === v;
      if (op === 'gte') return r[c] >= v;
      return true;
    }));
  }
  function ordenar(rows, ordenes) {
    if (!ordenes.length) return rows;
    return rows.slice().sort((a, b) => {
      for (const [k, asc] of ordenes) {
        if (a[k] < b[k]) return asc ? -1 : 1;
        if (a[k] > b[k]) return asc ? 1 : -1;
      }
      return 0;
    });
  }

  function builder(nombre) {
    const st = { op: 'select', cols: '*', filtros: [], ordenes: [], limite: null, payload: null, single: false, returning: false };
    const api = {
      select(c) { if (st.op === 'select') st.cols = c || '*'; else st.returning = true; return api; },
      insert(o) { st.op = 'insert'; st.payload = o; return api; },
      upsert(o, opts) { st.op = 'upsert'; st.payload = o; st.conflict = opts && opts.onConflict; return api; },
      update(o) { st.op = 'update'; st.payload = o; return api; },
      eq(c, v) { st.filtros.push(['eq', c, v]); return api; },
      gte(c, v) { st.filtros.push(['gte', c, v]); return api; },
      order(c, o) { st.ordenes.push([c, !(o && o.ascending === false)]); return api; },
      limit(n) { st.limite = n; return api; },
      maybeSingle() { st.single = true; return api; },
      then(resolve, reject) { return ejecutar().then(resolve, reject); }
    };

    async function ejecutar() {
      const t = tablas[nombre];
      if (!t) return { data: null, error: { message: 'tabla inexistente: ' + nombre } };

      if (st.op === 'insert') {
        const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
        for (const o of arr) t.push(Object.assign({ id: seq++ }, o));
        return { data: null, error: null };
      }
      if (st.op === 'upsert') {
        const campos = st.conflict;
        let fila;
        const existente = campos ? t.find(r => r[campos] === st.payload[campos]) : null;
        if (existente) { Object.assign(existente, st.payload); fila = existente; }
        else { fila = Object.assign({ id: seq++ }, st.payload); t.push(fila); }
        return { data: st.returning ? fila : null, error: null };
      }
      if (st.op === 'update') {
        const hits = filtrar(t, st.filtros);
        hits.forEach(r => Object.assign(r, st.payload));
        const uno = hits[0] || null;
        return { data: st.returning ? (st.single ? uno : hits) : null, error: hits.length ? null : { message: '0 filas' } };
      }
      let rows = ordenar(filtrar(t, st.filtros), st.ordenes);
      if (st.limite) rows = rows.slice(0, st.limite);
      if (st.single) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    return api;
  }

  const client = {
    from: (nombre) => builder(nombre),
    async rpc(fn) {
      if (fn === 'refill_demo_slots') {
        const dias = 7;
        const hoy = new Date();
        for (let i = 0; i <= dias; i++) {
          const d = new Date(hoy.getTime() + i * 86400000);
          const dow = d.getDay();
          if (dow === 0) continue; // domingo no
          const fecha = d.toISOString().slice(0, 10);
          for (const hora of ['09:00', '10:00', '11:00', '12:00']) {
            if (!tablas.demo_slots.find(s => s.fecha === fecha && s.hora === hora)) {
              tablas.demo_slots.push({ id: seq++, fecha, hora, disponible: true, ocupado_por: null });
            }
          }
        }
      }
      return { data: null, error: null };
    },
    _tablas: tablas
  };
  return client;
}

/* ---------------- Config ---------------- */
const supabase = crearSupabaseFake();

// Servicios como los deja el SQL (semilla)
[
  ['app', 'Diseño de aplicación para reportes/monitoreo', 'Plataforma en la nube para reportes.'],
  ['capacitacion', 'Capacitaciones', 'Capacitación SST para tu personal.'],
  ['auditoria', 'Auditorías a tu centro de trabajo', 'Revisión de cumplimiento.'],
  ['asesoria', 'Asesoría y consultoría SST', 'Consultoría SSMA.'],
  ['ambiental', 'Auditoría de medio ambiente', 'Aspectos ambientales.'],
  ['software', 'Software a medida', 'Desarrollo a la medida.']
].forEach((s, i) => supabase._tablas.servicios_bot.push({
  orden: i + 1, clave: s[0], titulo: s[1], resumen: s[2], intro: s[2], activo: true
}));

const salidas = [];
async function enviar(dest, txt) { salidas.push({ dest, txt }); }

const servicios = require('./servicios');
const faqs = require('./faqs');
const embudo = require('./embudo');
servicios.init(supabase);
faqs.init(supabase);
embudo.init({ supabase, enviar });

/* ---------------- Pruebas ---------------- */
(async () => {
  let ok = 0;
  const prueba = async (nombre, fn) => { await fn(); ok++; console.log('  ✔ ' + nombre); };

  console.log('\n== 1. Menu de servicios ==');
  const saludo = await servicios.saludo();
  await prueba('saluda con la empresa', () => assert(saludo.includes('SECURY INOVATECH')));
  await prueba('lista los 6 servicios numerados', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) assert(saludo.includes(`\n${n}) `), 'falta opcion ' + n);
  });
  await prueba('incluye la opcion 0) entrar', () => assert(saludo.includes('0) Entrar a la aplicación')));
  await prueba('la opcion 1 es la app', async () => {
    const o = await servicios.porOpcion('1');
    assert.strictEqual(o.tipo, 'servicio');
    assert.strictEqual(o.servicio.clave, 'app');
  });
  await prueba('la opcion 0 es entrar', async () => {
    const o = await servicios.porOpcion('0');
    assert.strictEqual(o.tipo, 'entrar');
  });
  await prueba('opcion fuera de rango = null', async () => {
    assert.strictEqual(await servicios.porOpcion('9'), null);
    assert.strictEqual(await servicios.porOpcion('hola'), null);
  });

  console.log('\n== 2. Buscador de FAQ ==');
  await prueba('"cuanto cuesta" -> precios', () => {
    const r = faqs.buscar('cuanto cuesta la plataforma?');
    assert(r && r.faq.id === 'p_precios', r && r.faq.id);
  });
  await prueba('"como reporto un riesgo" -> uso', () => {
    const r = faqs.buscar('como reporto un acto inseguro');
    assert(r && r.faq.id === 'u_reportar', r && r.faq.id);
  });
  await prueba('"a que hora atienden" -> horario', () => {
    const r = faqs.buscar('a que hora atienden');
    assert(r && r.faq.id === 's_horario', r && r.faq.id);
  });
  await prueba('en contexto capacitacion NO responde precios de la app', () => {
    const r = faqs.buscar('cuanto cuesta', 'capacitacion');
    assert(r && r.faq.id === 'v_cap_precio', r && r.faq.id);
  });
  await prueba('no encontrado -> sugiere 3', () => {
    assert.strictEqual(faqs.buscar('quiero comprar pepinos'), null);
    assert.strictEqual(faqs.sugerencias('dinero para viajes a marte', 'app', 3).length, 0);
    assert(faqs.sugerencias('precio del plan basico', 'app', 3).length > 0);
  });
  await prueba('3 FAQ destacadas por servicio', () => {
    assert.strictEqual(faqs.destacadas('app', 3).length, 3);
    assert.strictEqual(faqs.destacadas('auditoria', 3).length, 3);
    assert(faqs.textoDestacadas('app').includes('0) Volver al menú'));
  });

  console.log('\n== 3. Embudo completo (score + cita) ==');
  const wa = '5218331039200';
  const sesion = {};
  const servicio = { clave: 'app', titulo: 'Diseño de aplicación para reportes/monitoreo' };

  salidas.length = 0;
  let r = await embudo.iniciar({ waId: wa, destinatario: wa, servicio });
  assert(r && r.paso === 'nombre', 'no arranco en nombre: ' + JSON.stringify(r));
  // igual que hace bot.js (arrancarEmbudo)
  sesion.paso = 'embudo';
  sesion.servicioClave = servicio.clave;
  sesion.servicioTitulo = servicio.titulo;
  sesion.embudoPaso = r.paso;
  sesion.score = r.score || 0;
  sesion.embudoSlot = false;
  assert(salidas.some(s => s.txt.includes('son solo 8 preguntas')));
  ok++; console.log('  ✔ arranca en el paso nombre');

  // [paso esperado, respuesta]
  const guion = [
    ['nombre', 'Ricardo Pérez'],
    ['empresa', 'Constructora XYZ, Monterrey'],
    ['cargo', '1'],           // Dueño -> 20
    ['trabajadores', '5'],    // 100+ -> 15
    ['obras', '3'],           // 3-4 obras -> 13
    ['proceso', '1'],         // papel -> 20
    ['cumplimiento', '1'],    // desordenado -> 10
    ['intereses', '1 3 4'],   // 3 intereses -> 10
    ['correo', 'ricardo@empresa.com'], // -> 5
    ['autoriza', '1']         // si -> 5 -> abre slots
  ];

  let esperado = 'nombre';
  for (const [pasoEsperado, respuesta] of guion) {
    assert.strictEqual(sesion.embudoPaso || 'nombre', pasoEsperado,
      `esperaba estar en ${pasoEsperado} y estoy en ${sesion.embudoPaso}`);
    salidas.length = 0;
    r = await embudo.procesar({ waId: wa, destinatario: wa, texto: respuesta, sesion });
    assert(r && typeof r === 'object', `respuesta invalida en ${pasoEsperado}`);
    if (r && typeof r === 'object') {
      if (r.paso) sesion.embudoPaso = r.paso;
      if (r.score !== undefined) sesion.score = r.score;
      sesion.embudoSlot = (r.paso === 'slot');
      if (process.env.DEBUG) console.log('   ', pasoEsperado, '->', r.paso || '(sale)', 'score', r.score);
    }
    if (r.salir) break;
  }

  await prueba('score acumulado = 98/100', () => assert.strictEqual(sesion.score, 98, 'score=' + sesion.score));
  await prueba('banda caliente', () => {
    const p = supabase._tablas.prospectos.find(x => x.wa_id === wa);
    assert.strictEqual(p.banda, 'caliente');
    assert.strictEqual(p.score, 98);
    assert.strictEqual(p.nombre, 'Ricardo Pérez');
    assert.strictEqual(p.empresa, 'Constructora XYZ');
    assert.strictEqual(p.ciudad, 'Monterrey');
    assert.deepStrictEqual(p.intereses.length, 3);
  });
  await prueba('10 respuestas bitacoradas', () => {
    assert.strictEqual(supabase._tablas.prospecto_respuestas.filter(x => x.prospecto_id).length, 10);
  });
  await prueba('ofrece slots de cita', () => {
    assert.strictEqual(sesion.embudoSlot, true);
    const m = salidas[salidas.length - 1].txt;
    assert(m.includes('Elige el horario'), m.slice(0, 60));
    assert(m.includes('1) 📅'));
  });

  // Elige la primera cita
  salidas.length = 0;
  r = await embudo.procesar({ waId: wa, destinatario: wa, texto: '1', sesion });
  await prueba('cita agendada y embudo cerrado', () => {
    assert(r && r.salir === true, JSON.stringify(r));
    const m = salidas.map(s => s.txt).join('\n');
    assert(m.includes('Cita demo agendada'), 'falta confirmacion de cita');
    assert(m.includes('98/100'));
    assert(m.includes('Trial de 15 días'));
  });
  await prueba('slot marcado como ocupado', () => {
    const ocupado = supabase._tablas.demo_slots.find(s => s.ocupado_por);
    assert(ocupado && ocupado.disponible === false);
    const p = supabase._tablas.prospectos.find(x => x.wa_id === wa);
    assert.strictEqual(p.etapa, 'cita_agendada');
    assert.strictEqual(p.slot_id, ocupado.id);
  });
  await prueba('aviso enviado al asesor', () => {
    const aviso = salidas.find(s => s.dest === '528331039200');
    assert(aviso, 'no llego el aviso al asesor');
    assert(aviso.txt.includes('NUEVO PROSPECTO CALIENTE'));
    assert(aviso.txt.includes('98/100'));
    assert(aviso.txt.includes('Constructora XYZ'));
    assert(aviso.txt.includes('Cita:'));
  });

  console.log('\n== 4. Reintentos y cancelacion ==');
  salidas.length = 0;
  const sesion2 = {};
  r = await embudo.iniciar({ waId: wa, destinatario: wa, servicio });
  await prueba('no repite la encuesta si ya participo', () => {
    assert(r && r.salir === true);
    assert(salidas.some(s => s.txt.includes('Ya tienes una cita')));
  });

  const wa2 = '521833999888';
  salidas.length = 0;
  await embudo.iniciar({ waId: wa2, destinatario: wa2, servicio });
  const sesion3 = { embudoPaso: 'nombre', servicioClave: 'app' };
  salidas.length = 0;
  r = await embudo.procesar({ waId: wa2, destinatario: wa2, texto: '0', sesion: sesion3 });
  await prueba('"0" cancela el embudo', () => {
    assert(r && r.salir === true);
    assert(salidas[0].txt.includes('cancelada'));
    assert.strictEqual(supabase._tablas.prospectos.find(x => x.wa_id === wa2).etapa, 'abandonado');
  });

  console.log('\n== 5. Aviso: el asesor confirma o libera ==');
  let avisado = null;
  let slotId5 = null;
  embudo.init({ supabase, enviar, alAvisar: (p) => { avisado = p; } });

  const wa3 = '521833555444';
  const sesion4 = { embudoPaso: 'nombre', servicioClave: 'app', servicioTitulo: 'App de reportes' };
  const ini4 = await embudo.iniciar({ waId: wa3, destinatario: wa3, servicio });
  sesion4.embudoPaso = ini4.paso;
  sesion4.score = ini4.score || 0;

  const guion4 = [
    ['nombre', 'Ana Torres'],
    ['empresa', 'Grupo Saltillo, Saltillo'],
    ['cargo', '1'],            // 20
    ['trabajadores', '5'],     // 15
    ['obras', '4'],            // 15
    ['proceso', '1'],          // 20
    ['cumplimiento', '1'],     // 10
    ['intereses', '1 2 3 4 5'],// 10
    ['correo', 'ana@saltillo.com'], // 5
    ['autoriza', '1'],         // 5 -> slots
    ['slot', '1']              // agenda -> avisa al asesor
  ];
  for (const [espera, resp] of guion4) {
    assert.strictEqual(sesion4.embudoPaso || 'nombre', espera,
      `esperaba estar en ${espera} y estoy en ${sesion4.embudoPaso}`);
    salidas.length = 0;
    const r4 = await embudo.procesar({ waId: wa3, destinatario: wa3, texto: resp, sesion: sesion4 });
    assert(r4 && typeof r4 === 'object', `respuesta invalida en ${espera}`);
    if (r4.paso) sesion4.embudoPaso = r4.paso;
    if (r4.score !== undefined) sesion4.score = r4.score;
    sesion4.embudoSlot = (r4.paso === 'slot');
    if (r4.salir) break;
  }

  await prueba('callback alAvisar recibe el prospecto', () => {
    assert(avisado && avisado.id, 'no se llamo alAvisar');
    assert.strictEqual(avisado.wa_id, wa3);
    assert.strictEqual(avisado.notas, 'avizado');
  });
  await prueba('confirmarCita marca la cita como confirmada', async () => {
    const r = await embudo.confirmarCita(avisado.id);
    assert(r.ok, r.error);
    assert(r.fechaTexto, 'falta la fecha legible');
    const p = supabase._tablas.prospectos.find(x => x.wa_id === wa3);
    assert.strictEqual(p.notas, 'confirmado');
    assert.strictEqual(p.etapa, 'cita_confirmada');
    slotId5 = p.slot_id;
    const slot = supabase._tablas.demo_slots.find(s => s.id === slotId5);
    assert(slot && slot.disponible === false, 'confirmar no debe liberar el horario');
  });
  await prueba('liberarCita devuelve el horario al calendario', async () => {
    const r = await embudo.liberarCita(avisado.id);
    assert(r.ok, r.error);
    const p = supabase._tablas.prospectos.find(x => x.wa_id === wa3);
    assert.strictEqual(p.slot_id, null);
    assert.strictEqual(p.notas, 'liberado');
    const slot = supabase._tablas.demo_slots.find(s => s.id === slotId5);
    assert(slot, 'desaparecio el horario');
    assert.strictEqual(slot.disponible, true, 'el horario no se libero');
    assert.strictEqual(slot.ocupado_por, null);
  });
  await prueba('confirmarCita con id inexistente no truena', async () => {
    const r = await embudo.confirmarCita(999999);
    assert.strictEqual(r.ok, false);
    assert(r.error, 'debia decir que fallo');
  });

  console.log('\n== 6. Correos (agendada/confirmada) y recordatorio 1 h antes ==');
  const correos = [];
  embudo.init({
    supabase, enviar,
    alAvisar: (p) => { avisado = p; },
    enviarCorreo: (p, tipo, extra) => { correos.push({ tipo, correo: p && p.correo, extra: extra || {} }); }
  });

  const wa4 = '521811234888';
  const sesion6 = { paso: 'embudo', servicioClave: servicio.clave, servicioTitulo: servicio.titulo, embudoPaso: null, score: 0, embudoSlot: false };
  const ini6 = await embudo.iniciar({ waId: wa4, destinatario: wa4, servicio });
  sesion6.embudoPaso = ini6.paso;
  sesion6.score = ini6.score || 0;
  const guion6 = [
    ['nombre', 'Luis Ramírez'], ['empresa', 'Ladrillera Sur, Torreón'],
    ['cargo', '1'], ['trabajadores', '5'], ['obras', '4'], ['proceso', '1'],
    ['cumplimiento', '1'], ['intereses', '1 2 3'], ['correo', 'luis@ladrillera.com'],
    ['autoriza', '1'], ['slot', '1']
  ];
  for (const [espera, resp] of guion6) {
    assert.strictEqual(sesion6.embudoPaso || 'nombre', espera,
      `s6 esperaba ${espera} y estoy en ${sesion6.embudoPaso}`);
    salidas.length = 0;
    const r6 = await embudo.procesar({ waId: wa4, destinatario: wa4, texto: resp, sesion: sesion6 });
    assert(r6 && typeof r6 === 'object', `respuesta invalida en ${espera}`);
    if (r6.paso) sesion6.embudoPaso = r6.paso;
    if (r6.score !== undefined) sesion6.score = r6.score;
    sesion6.embudoSlot = (r6.paso === 'slot');
    if (r6.salir) break;
  }
  await prueba('correo "agendada" al reservar cita', () => {
    const c = correos.find(x => x.tipo === 'agendada' && x.correo === 'luis@ladrillera.com');
    assert(c, 'no llego el correo agendada: ' + JSON.stringify(correos));
    assert(c.extra.fecha && c.extra.hora, 'falta fecha/hora en el correo');
  });
  const luis = supabase._tablas.prospectos.find(x => x.wa_id === wa4);
  await prueba('correo "confirmada" cuando el asesor responde SI', async () => {
    const r = await embudo.confirmarCita(luis.id);
    assert(r.ok, r.error);
    const c = correos.find(x => x.tipo === 'confirmada' && x.correo === 'luis@ladrillera.com');
    assert(c, 'no llego el correo confirmada');
    assert(c.extra.fecha && c.extra.hora, 'falta fecha/hora en el correo');
  });
  // Evita que la cita real de Luis dispare un recordatorio según la hora del día
  luis.recordado_1h = true;

  const recordatorios = require('./recordatorios');
  const ahora6 = Date.now();
  // los slots se guardan en hora local: en zona -06:00 el reloj lee UTC - 6h
  const iso6 = (m) => new Date(m - 6 * 3600 * 1000).toISOString();
  const casos6 = [
    { mins: 30, espera: true },
    { mins: 120, espera: false },
    { mins: -120, espera: false }
  ];
  const metas = [];
  for (const c of casos6) {
    const t = ahora6 + c.mins * 60000;
    const fecha = iso6(t).slice(0, 10), hora = iso6(t).slice(11, 16);
    await supabase.from('demo_slots').insert({ fecha, hora, disponible: false, ocupado_por: 'rec-' + c.mins });
    const slot = supabase._tablas.demo_slots.find(s => s.fecha === fecha && s.hora === hora);
    const wa6 = '52180000' + (c.mins > 0 ? 'p' : 'm') + Math.abs(c.mins);
    supabase._tablas.prospectos.push({
      id: 9000 + c.mins, wa_id: wa6, nombre: 'Prospecto ' + c.mins,
      correo: 'p' + (c.mins > 0 ? 'p' : 'm') + Math.abs(c.mins) + '@x.com', slot_id: slot.id,
      etapa: 'cita_confirmada', recordado_1h: false
    });
    metas.push({ mins: c.mins, espera: c.espera, wa: wa6, slotId: slot.id });
  }
  const n6 = await recordatorios.revisar({
    supabase, enviar,
    correo: (p, tipo, extra) => correos.push({ tipo, correo: p.correo, extra: extra || {} }),
    ahora: ahora6, ventanaMin: 60
  });
  await prueba('solo se envia 1 recordatorio (el de +30 min)', async () => {
    assert.strictEqual(n6, 1);
    for (const m of metas) {
      const p = supabase._tablas.prospectos.find(x => x.wa_id === m.wa);
      assert.strictEqual(p.recordado_1h, m.espera,
        `prospecto ${m.mins}min: recordado_1h debe ser ${m.espera}`);
    }
  });
  await prueba('recordatorio sale por WhatsApp y correo', async () => {
    const m = metas.find(x => x.espera);
    assert(salidas.some(s => s.dest === m.wa && s.txt.includes('Recordatorio')), 'falta el WhatsApp del recordatorio');
    assert(correos.some(c => c.tipo === 'recordatorio' && c.correo === 'pp30@x.com'), 'falta el correo del recordatorio');
  });

  console.log(`\n✅ ${ok} comprobaciones OK\n`);
})().catch(e => { console.error('\n❌ FALLA:', e.message); process.exit(1); });
