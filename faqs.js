// ============================================================
//  PREGUNTAS FRECUENTES (FAQ) - Bot SECURY INOVATECH
//
//  Como funciona el buscador:
//   - todo se normaliza (sin acentos, minusculas, sin signos)
//   - cada FAQ trae "palabras_clave"; se suman puntos por
//     coincidir (frase completa vale mas que palabra suelta)
//   - se queda con el de mayor puntaje
//   - si NINGUNO pasa el umbral, se sugieren 3 parecidas y
//     se guarda la busqueda en `faq_consultas` (ahi ves que
//     FAQ faltan)
//
//  campo "servicio":
//   - null  -> aplica a todos los servicios (soporte, pago, etc.)
//   - 'app' -> solo del servicio 1 (aplicacion de reportes)
//   - otro  -> solo de ese servicio (capacitacion, auditoria...)
// ============================================================

function norma(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VACIAS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'y', 'o', 'a', 'en', 'con',
  'por', 'para', 'es', 'se', 'mi', 'tu', 'su', 'me', 'te', 'lo', 'como', 'cual', 'cuales',
  'hay', 'tiene', 'tienen', 'hacer', 'puedo', 'puede', 'quiero', 'sobre', 'este', 'esta'
]);

const FAQS = [
  /* ---------------------------------------------------------- PRECIOS (app) */
  {
    id: 'p_precios', servicio: 'app', categoria: 'Precios',
    pregunta: '¿Cuánto cuesta la plataforma?',
    palabras_clave: ['precio', 'precios', 'cuesta', 'costo', 'costos', 'tarifa', 'tarifas', 'cuanto vale', 'cuanto cuesta', 'planes', 'plan'],
    respuesta:
      'Tenemos *3 planes mensuales* (precios con IVA):\n\n' +
      '🟢 *Básico* — $1,200 MXN/mes · hasta 10 usuarios\n' +
      '🔵 *Pro* — $2,800 MXN/mes · hasta 25 usuarios *(el más contratado)*\n' +
      '🟣 *Empresa* — $4,900 MXN/mes · usuarios ilimitados\n\n' +
      '¿Te digo qué incluye cada uno? Escribe *"planes"*.'
  },
  {
    id: 'p_planes', servicio: 'app', categoria: 'Precios',
    pregunta: '¿Qué incluye cada plan?',
    palabras_clave: ['que incluye', 'que trae', 'diferencia entre planes', 'caracteristicas', 'que incluye el plan', 'basico pro empresa', 'que diferencia'],
    respuesta:
      '*🟢 Básico*\n· Actos y condiciones inseguras\n· Archivo diario (permisos de trabajo y check lists)\n· Exportar a Excel/CSV\n\n' +
      '*🔵 Pro* (todo lo del Básico +)\n· Reporte semanal de seguridad\n· Módulos SSMA: accidentes, auditorías, ambientales, capacitaciones, simulacros e inspecciones\n· Dashboard + contador de días sin accidentes\n· Soporte normal\n\n' +
      '*🟣 Empresa* (todo lo del Pro +)\n· Múltiples obras\n· Soporte prioritario\n· Almacenamiento ampliado'
  },
  {
    id: 'p_anual', servicio: 'app', categoria: 'Precios',
    pregunta: '¿Hay descuento si pago el año completo?',
    palabras_clave: ['anual', 'descuento', 'descuentos', 'adelantado', '12 meses', 'por año', 'precio anual'],
    respuesta:
      'Sí. Si pagas el año por adelantado recibes *2 meses gratis* (pagas 10 en lugar de 12).'
  },
  {
    id: 'p_obras', servicio: 'app', categoria: 'Precios',
    pregunta: '¿Cuántas obras incluye y cuánto cobra por obra extra?',
    palabras_clave: ['obra', 'obras', 'proyecto', 'proyectos', 'obra adicional', 'mas obras', 'varias obras', 'sucursal'],
    respuesta:
      'Plan *Pro*: incluye 3 obras, cada obra adicional son *+$500 MXN/mes*.\n' +
      'Plan *Empresa*: incluye 3 obras, cada obra extra son *+$400 MXN/mes*.\n\n' +
      'Cada obra se administra y se visualiza por separado (reportes, avance y cumplimiento por obra).'
  },
  {
    id: 'p_usuarios', servicio: 'app', categoria: 'Precios',
    pregunta: '¿Cuánto cuesta agregar un usuario más?',
    palabras_clave: ['usuario extra', 'usuarios extra', 'licencia', 'usuario adicional', 'cuanto por usuario', 'empleados extra', 'supervisor extra'],
    respuesta:
      '· Supervisor o administrador extra: *$450 MXN por usuario al mes*.\n' +
      '· Trabajadores que solo reportan desde su celular: *GRATIS*.\n\n' +
      'O sea, solo pagas por quien administra y vigila.'
  },
  {
    id: 'p_servicios_impl', servicio: 'app', categoria: 'Precios',
    pregunta: '¿Cuánto cuesta la implementación y la capacitación?',
    palabras_clave: ['implementacion', 'capacitacion', 'migracion', 'entrenamiento', 'instalacion', 'configuracion', 'personalizacion', 'a medida hora'],
    respuesta:
      'Servicios opcionales:\n\n' +
      '· Implementación + capacitación (pago único): *$5,000 a $8,000*\n' +
      '· Migración de datos (de tus Excels o registros anteriores): *$2,000 a $4,000*\n' +
      '· Entrenamiento premium presencial (Monterrey): *$3,500 por día*\n' +
      '· Personalización o módulo a medida: *desde $600 por hora*'
  },
  {
    id: 'p_pago', servicio: null, categoria: 'Precios',
    pregunta: '¿Cómo se paga y si facturan?',
    palabras_clave: ['pago', 'pagar', 'transferencia', 'tarjeta', 'factura', 'facturan', 'cfdi', 'banco', 'metodo de pago'],
    respuesta:
      'Aceptamos *tarjeta y transferencia*, y facturamos con *CFDI*. Los precios incluyen IVA.'
  },
  {
    id: 'p_multas', servicio: null, categoria: 'Precios',
    pregunta: '¿Por qué vale la pena? ¿Qué riesgo tengo si no lo tengo?',
    palabras_clave: ['multa', 'multas', 'stps', 'sancion', 'sanciones', 'imss', 'por que', 'vale la pena', 'riesgo', 'auditoria de la stps'],
    respuesta:
      'Las multas de la *STPS* por incumplimiento van de más de *$29,000* hasta más de *$580,000 MXN por infracción*, sin contar una obra detenida o el costo humano de un accidente.\n\n' +
      '*Un mes de la plataforma cuesta menos del 1% de una sola multa* y te da respaldo documental ante STPS, IMSS y auditorías.'
  },

  /* ------------------------------------------------- CARACTERISTICAS (app) */
  {
    id: 'c_que_es', servicio: 'app', categoria: 'La plataforma',
    pregunta: '¿Qué es exactamente la plataforma?',
    palabras_clave: ['que es', 'que hace', 'como funciona', 'de que se trata', 'plataforma', 'aplicacion', 'app de reportes'],
    respuesta:
      'Es una plataforma en la nube (SSMA) para que empresas de mantenimiento, construcción y servicios lleven *todos sus registros de seguridad en un solo lugar*, desde cualquier celular con internet.\n\n' +
      'Sirve para registrar actos y condiciones inseguras, sacar el reporte semanal, guardar permisos de trabajo y check lists, y gestionar accidentes, auditorías, capacitaciones, simulacros e inspecciones.'
  },
  {
    id: 'c_modulos', servicio: 'app', categoria: 'La plataforma',
    pregunta: '¿Qué módulos tiene?',
    palabras_clave: ['modulos', 'que modulos', 'funciones', 'que funciones', 'que puedo hacer', 'herramientas'],
    respuesta:
      '*Módulos:*\n\n' +
      '· Actos y condiciones inseguras\n· Reporte semanal de seguridad\n· Archivo diario (permisos de trabajo, check lists, LOTO, herramientas)\n· Accidentes e incidentes\n· Auditorías\n· Aspectos ambientales\n· Capacitaciones y calendario de pláticas\n· Simulacros\n· Inspecciones de seguridad\n· Monitoreo de turno con evidencias\n· Pantalla informativa y contador de días sin accidentes'
  },
  {
    id: 'c_excel', servicio: 'app', categoria: 'La plataforma',
    pregunta: '¿Se puede exportar a Excel?',
    palabras_clave: ['excel', 'exportar', 'csv', 'descargar datos', 'reporte en excel', 'hoja de calculo'],
    respuesta:
      'Sí. Puedes *exportar a Excel o CSV* por semana o por rango de fechas, listo para entregar a tu cliente o para una auditoría.'
  },
  {
    id: 'c_dashboard', servicio: 'app', categoria: 'La plataforma',
    pregunta: '¿Tiene tablero o indicadores?',
    palabras_clave: ['dashboard', 'tablero', 'indicadores', 'estadisticas', 'dias sin accidentes', 'contador', 'cumplimiento', 'graficas'],
    respuesta:
      'Sí:\n\n' +
      '· *Tablero de control SSMA*\n· *Contador de días sin accidentes*\n· *% de cumplimiento* por compañía (corregidos vs pendientes)\n· *Auditoría de cambios*: quién dio de alta, modificó o borró cada registro, con posibilidad de restaurar.'
  },
  {
    id: 'c_qr', servicio: 'app', categoria: 'La plataforma',
    pregunta: '¿Puede reportar alguien que no tiene cuenta?',
    palabras_clave: ['sin cuenta', 'sin registro', 'qr', 'codigo qr', 'publico', 'cualquiera', 'sin usuario', 'invitado'],
    respuesta:
      'Sí. Existe el *Reporte público con QR*: generas el código, lo pegas en la obra o lo compartes, y cualquiera escanea y reporta un riesgo *sin necesidad de crear cuenta*.'
  },
  {
    id: 'c_cel', servicio: 'app', categoria: 'La plataforma',
    pregunta: '¿Funciona en el celular? ¿Hay que instalar algo?',
    palabras_clave: ['celular', 'movil', 'telefono', 'android', 'iphone', 'instalar', 'aplicacion movil', 'descargar app', 'navegador', 'internet'],
    respuesta:
      'Funciona desde el *celular y la computadora*, en el navegador (es una PWA: se puede instalar en la pantalla de inicio como si fuera app).\n\n' +
      '*No hay que descargar nada* de tiendas y solo necesitas internet para sincronizar.'
  },

  /* ------------------------------------------------------------- USO (app) */
  {
    id: 'u_reportar', servicio: 'app', categoria: 'Uso diario',
    pregunta: '¿Cómo reporto un acto o condición insegura?',
    palabras_clave: ['reportar', 'reporte', 'como reporto', 'acto inseguro', 'condicion insegura', 'nuevo reporte', 'riesgo'],
    respuesta:
      '1️⃣ Entras a la app → *Nuevo reporte*\n2️⃣ Eliges categoría y nivel de riesgo\n3️⃣ Describes el peligro y la acción correctiva\n4️⃣ Asignas responsable y fecha de compromiso\n5️⃣ Adjuntas la foto y envías\n\n' +
      'El responsable recibe el reporte y hasta que sube la evidencia de cierre queda como *Corregido*.'
  },
  {
    id: 'u_permisos', servicio: 'app', categoria: 'Uso diario',
    pregunta: '¿Cómo se guardan los permisos de trabajo?',
    palabras_clave: ['permiso', 'permisos', 'permiso de trabajo', 'archivo diario', 'check list', 'checklist', 'herramientas', 'epp'],
    respuesta:
      'En el *Archivo Diario* subes la foto o el PDF escaneado del permiso de trabajo y de los check lists (herramientas, escaleras, extensiones eléctricas, extintores, EPP). Todo queda guardado por día y a la mano para auditoría.'
  },
  {
    id: 'u_monitoreo', servicio: 'app', categoria: 'Uso diario',
    pregunta: '¿Qué es el Monitoreo de Turno?',
    palabras_clave: ['monitoreo', 'monitoreo de turno', 'turno', 'evidencias al grupo', 'whatsapp grupo', 'avance', 'fotos al grupo'],
    respuesta:
      'El supervisor manda las evidencias al *grupo de WhatsApp* de la obra y el bot las sube y registra en 12 secciones (fuerza de trabajo, plática, permisos, APR, herramientas, delimitaciones, recorridos horarios, carpeta SIGA, LOTO, pausa, orden y cierre).\n\n' +
      'Al terminar te contesta: *"✅ Avance 7/12 (58%)"* y todo queda en la app.'
  },
  {
    id: 'u_incorreccion', servicio: 'app', categoria: 'Uso diario',
    pregunta: '¿Qué pasa con un reporte que no se ha corregido?',
    palabras_clave: ['pendiente', 'corregido', 'correccion', 'seguimiento', 'no se ha corregido', 'evidencia de cierre', 'cerrar reporte'],
    respuesta:
      'El reporte queda en *Pendiente* con su nota, responsable y fecha de compromiso. Cuando suben la evidencia de cierre pasa a *Corregido* y se ve el historial completo.\n\n' +
      'Si algo sale mal, el admin puede regresarlo a pendiente: la acción queda registrada en la auditoría de cambios.'
  },

  /* ------------------------------------------------------ CUENTA (app) */
  {
    id: 'k_registro', servicio: 'app', categoria: 'Cuenta',
    pregunta: '¿Cómo creo una cuenta?',
    palabras_clave: ['crear cuenta', 'registrarme', 'registro', 'alta', 'como me doy de alta', 'suscribirme'],
    respuesta:
      'El registro es *solo por invitación*: un administrador existente te envía un enlace que sirve *una sola vez* para crear una cuenta.\n\n' +
      'Si necesitas una, escribe *"demo"* y te la gestionamos.'
  },
  {
    id: 'k_invitacion', servicio: 'app', categoria: 'Cuenta',
    pregunta: 'Tengo una invitación, ¿cómo la uso?',
    palabras_clave: ['invitacion', 'invitado', 'link de invitacion', 'un solo uso', 'no me deja crear cuenta'],
    respuesta:
      'Abres el enlace de la invitación, llenas nombre, correo, celular y contraseña, aceptas los Términos y el Contrato de Confidencialidad y listo.\n\n' +
      'Cada invitación sirve para *una sola cuenta*. Si ya se usó, pide otra al administrador.'
  },
  {
    id: 'k_roles', servicio: 'app', categoria: 'Cuenta',
    pregunta: '¿Quién ve qué? ¿Qué roles hay?',
    palabras_clave: ['roles', 'permisos de usuario', 'quien ve', 'admin', 'administrador', 'coordinador', 'usuarios'],
    respuesta:
      'Hay 4 niveles: *adminPrincipal*, *admin*, *coordinador* y *usuario*.\n\n' +
      'El admin da de alta y cambia roles; cada alta, modificación o borrado queda en la *bitácora de auditoría* con opción de restaurar.'
  },
  {
    id: 'k_password', servicio: null, categoria: 'Cuenta',
    pregunta: 'Olvidé mi contraseña',
    palabras_clave: ['olvide mi contrasena', 'no recuerdo mi contrasena', 'contrasena', 'password', 'no puedo entrar', 'acceso bloqueado'],
    respuesta:
      'Escríbele a *soporte por WhatsApp: 833 103 9200* y te ayudamos a restablecerla desde el panel de administración.'
  },

  /* -------------------------------------------- SOPORTE / CONTRATO (global) */
  {
    id: 's_soporte', servicio: null, categoria: 'Soporte',
    pregunta: '¿Cómo pido soporte técnico?',
    palabras_clave: ['soporte', 'ayuda', 'problema', 'no funciona', 'falla', 'tecnico', 'contacto'],
    respuesta:
      '· WhatsApp: *833 103 9200* (también está el botón "Soporte técnico" dentro de la app)\n' +
      '· O escribe *"asesor"* aquí y te pasamos con alguien.'
  },
  {
    id: 's_horario', servicio: null, categoria: 'Soporte',
    pregunta: '¿Cuál es el horario de atención?',
    palabras_clave: ['horario', 'atencion', 'a que hora', 'cuando contestan', 'dias de trabajo', 'sabado', 'domingo'],
    respuesta:
      'Soporte de *lunes a sábado de 9:00 a.m. a 1:00 p.m.*\n\n' +
      'Otros horarios (incluido domingo) se agendan con tiempo por WhatsApp.'
  },
  {
    id: 'k_datos', servicio: null, categoria: 'Contrato',
    pregunta: '¿Quién ve mis datos? ¿Son confidenciales?',
    palabras_clave: ['datos', 'confidencial', 'privacidad', 'seguridad de la informacion', 'respaldo', 'backup', 'comparten mis datos'],
    respuesta:
      'Tus datos son tuyos. Los tratamos de forma *confidencial* y no los compartimos con terceros sin tu autorización. Incluimos respaldos y exportaciones, y al terminar el contrato puedes solicitar la exportación de tu información.'
  },
  {
    id: 'k_contrato', servicio: null, categoria: 'Contrato',
    pregunta: '¿Cómo es el contrato?',
    palabras_clave: ['contrato', 'vigencia', 'compromiso', 'minimo de meses', 'cancelar', 'terminar', 'renovacion'],
    respuesta:
      '· Vigencia mínima de *12 meses*\n· Pago mensual, facturación con CFDI\n· Ajuste anual según la *UMA*, avisando con 30 días de anticipación\n· Cualquiera de las partes puede terminar por incumplimiento con aviso de 30 días\n· Mora mayor a 15 días suspende el servicio'
  },
  {
    id: 'p_prueba', servicio: 'app', categoria: 'Proceso',
    pregunta: '¿Hay prueba gratis o demo?',
    palabras_clave: ['prueba', 'gratis', 'trial', 'demo', 'demostracion', 'probar', 'ver la app', 'prueba gratuita'],
    respuesta:
      '1️⃣ Primero agendamos una *demo guiada* (unos 30 min, por videollamada o presencial).\n' +
      '2️⃣ Después de la demo te ofrecemos un *trial de 15 días* con tus datos reales.\n' +
      '3️⃣ Si decides, tu app queda lista en *1 día a 1 semana* después de la cita (requiere contrato, definir plan y servicios, y un anticipo).\n\n' +
      '👉 Escribe *demo* y te agendo la cita.'
  },

  /* ------------------------------------------- SERVICIO: CAPACITACION */
  {
    id: 'v_cap_incluye', servicio: 'capacitacion', categoria: 'Capacitaciones',
    pregunta: '¿Qué temas dan en las capacitaciones?',
    palabras_clave: ['temas', 'que dan', 'contenido', 'capacitaciones', 'temario', 'curso', 'cursos', 'entrenamiento'],
    respuesta:
      'Trabajamos temas de seguridad, salud y medio ambiente a la medida de tu operación:\n\n' +
      '· Análisis de riesgos y permisos de trabajo\n· Riesgos eléctricos, trabajos en altura, espacios confinados\n· LOTO (bloqueo y etiquetado)\n· Simulacros y brigadas\n· Uso y cuidado del EPP\n· Cultura de seguridad y reporte de actos inseguros\n\n' +
      'Presencial o en línea, para operativos y para personal de oficina.'
  },
  {
    id: 'v_cap_precio', servicio: 'capacitacion', categoria: 'Capacitaciones',
    pregunta: '¿Cuánto cuesta una capacitación?',
    palabras_clave: ['cuanto cuesta', 'costo', 'precio', 'costo capacitacion', 'precio capacitacion', 'precio curso', 'costo curso'],
    respuesta:
      'Se cotiza según número de participantes, tema y duración. Como referencia, el *entrenamiento premium presencial en Monterrey es de $3,500 por día*.\n\n' +
      'Escribe *"demo"* y te armamos una propuesta con tu temario.'
  },

  /* ------------------------------------------- SERVICIO: AUDITORIA */
  {
    id: 'v_aud_incluye', servicio: 'auditoria', categoria: 'Auditorías',
    pregunta: '¿Qué incluye la auditoría a mi centro de trabajo?',
    palabras_clave: ['que incluye auditoria', 'proceso de auditoria', 'como hacen la auditoria', 'hallazgos', 'revisar mi centro'],
    respuesta:
      '1️⃣ Revisamos tus registros y documentación\n' +
      '2️⃣ Recorremos el centro de trabajo con checklist\n' +
      '3️⃣ Detectamos hallazgos con evidencia fotográfica\n' +
      '4️⃣ Te entregamos un *plan de acciones* con responsables y fechas\n\n' +
      'Todo queda cargado en la plataforma para que des seguimiento y lo presentes ante STPS o tu cliente.'
  },
  {
    id: 'v_aud_precio', servicio: 'auditoria', categoria: 'Auditorías',
    pregunta: '¿Cuánto cuesta una auditoría?',
    palabras_clave: ['cuanto cuesta', 'costo', 'precio', 'costo auditoria', 'precio auditoria', 'cuanto cuesta auditar'],
    respuesta:
      'Se cotiza según tamaño del centro de trabajo, número de áreas y alcance (SSMA o también ambiental).\n\n' +
      'Escribe *"demo"* y te preparamos la propuesta.'
  },

  /* ------------------------------------------- SERVICIO: ASESORIA */
  {
    id: 'v_ases_incluye', servicio: 'asesoria', categoria: 'Asesoría',
    pregunta: '¿Qué hace el consultor en la asesoría?',
    palabras_clave: ['que hace el consultor', 'asesoria', 'consultoria', 'que incluye la asesoria', 'sistema de gestion'],
    respuesta:
      'Te apoyamos a armar o mejorar tu sistema de gestión SSMA:\n\n' +
      '· Estructura de responsabilidades y procedimientos\n· Indicadores y tableros\n· Atención a hallazgos de auditoría externa\n· Mejora continua\n\n' +
      'Puede venir acompañado de la plataforma para que todo quede documentado.'
  },
  {
    id: 'v_ases_precio', servicio: 'asesoria', categoria: 'Asesoría',
    pregunta: '¿Cuánto cuesta la asesoría?',
    palabras_clave: ['cuanto cuesta', 'costo', 'precio', 'costo asesoria', 'precio asesor', 'honorarios'],
    respuesta:
      'Se cotiza por alcance (por proyecto o por mensualidad acompañamiento). Escribe *"demo"* y te armamos la propuesta.'
  },

  /* ------------------------------------------- SERVICIO: AMBIENTAL */
  {
    id: 'v_amb_incluye', servicio: 'ambiental', categoria: 'Medio ambiente',
    pregunta: '¿Qué revisan en la auditoría ambiental?',
    palabras_clave: ['ambiental', 'medio ambiente', 'residuos', 'agua', 'energia', 'aspectos ambientales', 'cumplimiento ambiental'],
    respuesta:
      'Revisamos los aspectos ambientales de tu operación:\n\n' +
      '· Residuos (manejo, manifestaciones, disposición final)\n· Consumo de agua y energía\n· Emisiones y manejo de químicos\n· Cumplimiento legal\n· Oportunidades de mejora\n\n' +
      'Entregamos hallazgos con evidencia y un plan de acciones.'
  },
  {
    id: 'v_amb_precio', servicio: 'ambiental', categoria: 'Medio ambiente',
    pregunta: '¿Cuánto cuesta la auditoría ambiental?',
    palabras_clave: ['cuanto cuesta', 'costo', 'precio', 'costo ambiental', 'precio auditoria ambiental'],
    respuesta:
      'Se cotiza según operación, número de instalaciones y alcance. Escribe *"demo"* y te preparamos la propuesta.'
  },

  /* ------------------------------------------- SERVICIO: SOFTWARE */
  {
    id: 'v_sw_incluye', servicio: 'software', categoria: 'Software a medida',
    pregunta: '¿Qué tipo de software desarrollan a medida?',
    palabras_clave: ['a medida', 'software a medida', 'desarrollo', 'sistema propio', 'integracion', 'automatizar', 'app personalizada'],
    respuesta:
      'Desarrollamos lo que tu operación necesite:\n\n' +
      '· Formularios y capturas móviles\n· Tableros y reportes automáticos\n· Integraciones con tus sistemas\n· Automatización de procesos\n\n' +
      'Partimos de lo que ya tenemos (la plataforma de reportes) y lo adaptamos a tu flujo.'
  },
  {
    id: 'v_sw_precio', servicio: 'software', categoria: 'Software a medida',
    pregunta: '¿Cuánto cuesta un desarrollo a medida?',
    palabras_clave: ['cuanto cuesta', 'costo', 'precio', 'costo software', 'precio desarrollo', 'costo a medida', 'por hora'],
    respuesta:
      'Se cotiza por alcance; la personalización y los módulos a medida parten desde *$600 por hora*.\n\n' +
      'Escribe *"demo"* y conversamos sobre tu proyecto.'
  }
];

/* ----------------------------- BUSCADOR ----------------------------- */

// Puntaje de coincidencia entre un texto y las palabras clave de un FAQ.
function puntaje(textoNorm, faq, contexto) {
  let total = 0;
  for (const kw of faq.palabras_clave) {
    const k = norma(kw);
    if (!k) continue;
    if (textoNorm.includes(k)) {
      total += k.includes(' ') ? 3 : 2;
    } else {
      // palabra suelta dentro de una frase larga
      const partes = k.split(' ');
      if (partes.length > 1 && partes.every(p => p.length > 3 && textoNorm.includes(p))) total += 1;
    }
  }
  if (total > 0 && contexto && faq.servicio === contexto) total += 2;
  return total;
}

const UMBRAL = 3;

// Devuelve { faq, puntos } con la mejor coincidencia, o null.
function buscar(texto, contexto) {
  const t = norma(texto);
  if (!t) return null;
  const ctx = contexto || 'app';
  let mejor = null;
  for (const faq of FAQS) {
    if (faq.servicio && faq.servicio !== ctx) continue;
    const p = puntaje(t, faq, ctx);
    if (p >= UMBRAL && (!mejor || p > mejor.puntos)) mejor = { faq, puntos: p };
  }
  return mejor;
}

// Hasta n preguntas parecidas (para el mensaje "no entendí, ¿te refieres a...?")
function sugerencias(texto, contexto, n) {
  const t = norma(texto);
  const ctx = contexto || 'app';
  return FAQS
    .filter(f => !f.servicio || f.servicio === ctx)
    .map(f => ({ faq: f, p: puntaje(t, f, ctx) }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p)
    .slice(0, n || 3)
    .map(x => x.faq);
}

function textoFaq(faq) {
  return `❓ *${faq.pregunta}*\n\n${faq.respuesta}`;
}

// FAQ que se muestran como atajos al entrar a un servicio
const DESTACADAS = {
  app: ['p_precios', 'p_planes', 'c_que_es', 'p_prueba'],
  capacitacion: ['v_cap_incluye', 'v_cap_precio', 's_horario'],
  auditoria: ['v_aud_incluye', 'v_aud_precio', 's_horario'],
  asesoria: ['v_ases_incluye', 'v_ases_precio', 's_horario'],
  ambiental: ['v_amb_incluye', 'v_amb_precio', 's_horario'],
  software: ['v_sw_incluye', 'v_sw_precio', 's_horario']
};

function destacadas(contexto, n) {
  const ids = DESTACADAS[contexto || 'app'] || DESTACADAS.app;
  const salida = [];
  for (const id of ids) {
    const f = FAQS.find(x => x.id === id);
    if (f) salida.push(f);
    if (salida.length >= (n || 3)) break;
  }
  return salida;
}

function porId(id) {
  return FAQS.find(x => x.id === id) || null;
}

// Mensaje de atajos numerados ("1) ¿cuánto cuesta? ...")
function textoDestacadas(contexto) {
  const lista = destacadas(contexto, 3);
  if (!lista.length) return '';
  return '📌 *Preguntas frecuentes de este servicio:*\n\n' +
    lista.map((f, i) => `${i + 1}) ${f.pregunta}`).join('\n') +
    '\n0) Volver al menú\n\n' +
    'Responde con el *número*, o escribe tu pregunta.';
}

// Mensaje cuando no se encontró nada: 3 sugerencias + menu + demo
function textoNoEncontrado(texto, contexto, contextoTitulo) {
  const sugs = sugerencias(texto, contexto, 3);
  let m = '🤔 No estoy seguro de haber entendido.';
  if (sugs.length) {
    m += '\n\n¿Te referías a alguna de estas?\n' + sugs.map((f, i) => `${i + 1}) ${f.pregunta}`).join('\n');
    m += '\n\nResponde con el *número*.';
  } else {
    m += '\n\nPuedo contarte sobre *precios, planes, módulos, uso, contrato y soporte*.';
  }
  if (contextoTitulo) m += `\n\n( Servicio: *${contextoTitulo}* )`;
  m += '\n\n· Escribe *menu* para ver los servicios\n· Escribe *demo* para agendar una cita';
  return m;
}

/* --------------- BITÁCORA: qué preguntan y qué falta --------------- */
let supabase = null;
function init(client) { supabase = client; }

async function registrarConsulta(texto, encontrada, servicio, waId) {
  if (!supabase) return;
  try {
    await supabase.from('faq_consultas').insert({
      consulta: String(texto || '').slice(0, 300),
      encontrada: !!encontrada,
      servicio: servicio || null,
      wa_id: waId || null
    });
  } catch (e) {
    console.error('faq.registrarConsulta:', e.message);
  }
}

module.exports = {
  FAQS, buscar, sugerencias, textoFaq, textoNoEncontrado, registrarConsulta,
  destacadas, porId, textoDestacadas, init, norma
};
