// ============================================================
//  MENU DE SERVICIOS - SECURY INOVATECH
//  El primer mensaje que manda el bot (privado) muestra la
//  lista de servicios. Se lee de la tabla `servicios_bot`;
//  si la tabla esta vacia o Supabase falla, usa los de abajo.
//  La opcion "0" (entrar a la aplicacion) es fija: no se
//  guarda en la tabla porque es la ruta de login.
// ============================================================

const EMPRESA = process.env.EMPRESA_NOMBRE || 'SECURY INOVATECH';

const PREDETERMINADOS = [
  {
    clave: 'app',
    titulo: 'Diseño de aplicación para reportes/monitoreo',
    resumen: 'Plataforma en la nube para reportes, permisos de trabajo, monitoreo de turno y módulos SSMA.',
    intro: 'Nuestro producto estrella es la *Plataforma Reportes de Seguridad*: apps a la medida para que tus supervisores carguen reportes, evidencias y permisos desde el celular, con tablero, contador de días sin accidentes y exportación a Excel.'
  },
  {
    clave: 'capacitacion',
    titulo: 'Capacitaciones',
    resumen: 'Capacitación y entrenamiento en seguridad, salud y medio ambiente para tu personal.',
    intro: 'Damos *capacitaciones* presenciales y en línea para tu personal: temas de SST, simulacros, permisos de trabajo, análisis de riesgos y cultura de seguridad.'
  },
  {
    clave: 'auditoria',
    titulo: 'Auditorías a tu centro de trabajo',
    resumen: 'Revisión de cumplimiento normativo con hallazgos, acciones y evidencias.',
    intro: 'Llevamos a cabo *auditorías* a tu centro de trabajo: revisamos registros, recorremos áreas, detectamos hallazgos y te entregamos un plan de acciones con responsables y fechas.'
  },
  {
    clave: 'asesoria',
    titulo: 'Asesoría y consultoría SST',
    resumen: 'Consultoría especializada para armar o mejorar tu sistema de gestión SSMA.',
    intro: 'Te apoyamos con *asesoría y consultoría* en seguridad, salud y medio ambiente: estructura de tu sistema de gestión, responsabilidades, indicadores y mejora continua.'
  },
  {
    clave: 'ambiental',
    titulo: 'Auditoría de medio ambiente',
    resumen: 'Evaluación de aspectos ambientales, cumplimiento y oportunidades de mejora.',
    intro: 'Revisamos los *aspectos ambientales* de tu operación: residuos, agua, energía, cumplimiento legal y oportunidades de mejora con evidencia documental.'
  },
  {
    clave: 'software',
    titulo: 'Software a medida',
    resumen: 'Desarrollo de aplicaciones a la medida de tus procesos.',
    intro: 'Si necesitas algo distinto, *desarrollamos software a medida*: formularios, tableros, integraciones y automatizaciones adaptados a tu operación.'
  }
];

// Opcion fija siempre visible en el menu principal
const OPCION_ENTRAR = {
  n: 0,
  clave: 'entrar',
  titulo: 'Entrar a la aplicación',
  resumen: 'Ya soy usuario: cargar reportes, evidencias y permisos.'
};

let supabase = null;
let cache = null;
let cacheMs = 0;
const TTL_MS = 60 * 1000;

function init(client) {
  supabase = client;
}

function numerar(lista) {
  return lista.map((s, i) => Object.assign({}, s, { n: i + 1 }));
}

// Devuelve los servicios activos numerados (1..n). Cache de 1 minuto.
async function listar() {
  if (cache && (Date.now() - cacheMs) < TTL_MS) return cache;
  let lista = PREDETERMINADOS;
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('servicios_bot')
        .select('clave, titulo, resumen, intro, orden')
        .eq('activo', true)
        .order('orden', { ascending: true });
      if (!error && data && data.length) {
        lista = data.map(s => ({
          clave: s.clave,
          titulo: s.titulo,
          resumen: s.resumen || '',
          intro: s.intro || ''
        }));
      } else if (error) {
        console.error('servicios.listar:', error.message);
      }
    } catch (e) {
      console.error('servicios.listar:', e.message);
    }
  }
  cache = numerar(lista);
  cacheMs = Date.now();
  return cache;
}

function olvidarCache() {
  cache = null;
  cacheMs = 0;
}

// Texto del primer mensaje (saludo + lista de servicios)
async function saludo() {
  const lista = await listar();
  const lineas = lista.map(s => `${s.n}) ${s.titulo}\n     ${s.resumen}`);
  return (
    `👋 ¡Hola! Soy el asistente de *${EMPRESA}*.\n\n` +
    'Estos son nuestros servicios:\n\n' +
    lineas.join('\n\n') +
    `\n\n0) ${OPCION_ENTRAR.titulo}\n     ${OPCION_ENTRAR.resumen}\n\n` +
    '👉 Responde con el *número* del servicio que te interesa.\n' +
    'También puedes escribir directamente tu pregunta (ej. *"¿cuánto cuesta?"*).'
  );
}

// Texto corto cuando alguien pide "menu" a media conversacion
async function textoMenu() {
  const lista = await listar();
  return (
    `📋 *Menú de servicios — ${EMPRESA}*\n\n` +
    lista.map(s => `${s.n}) ${s.titulo}`).join('\n') +
    `\n0) ${OPCION_ENTRAR.titulo}\n\n` +
    'Escribe el *número*, o escribe tu pregunta.'
  );
}

// Convierte un "3" escrito por el usuario en servicio (o en la opcion 0)
// Devuelve: { tipo:'servicio', servicio } | { tipo:'entrar' } | null
async function porOpcion(texto) {
  const t = String(texto || '').trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  if (n === OPCION_ENTRAR.n) return { tipo: 'entrar' };
  const lista = await listar();
  const s = lista.find(x => x.n === n);
  return s ? { tipo: 'servicio', servicio: s } : null;
}

// Mensaje que abre la rama de un servicio: intro + que puede preguntar
function textoServicio(serv) {
  return (
    `✅ *${serv.titulo}*\n\n` +
    `${serv.intro}\n\n` +
    '— ¿Te explico algo? Escribe tu pregunta (ej. *"¿qué incluye?"*, *"¿cuánto cuesta?"*).\n' +
    '— ¿Quieres una propuesta a tu medida? Escribe *demo* y te agendo una cita con un asesor.'
  );
}

module.exports = { EMPRESA, OPCION_ENTRAR, init, listar, saludo, textoMenu, porOpcion, textoServicio, olvidarCache };
