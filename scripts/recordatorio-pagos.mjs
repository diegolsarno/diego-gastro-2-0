import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const SUPABASE_URL = 'https://idcndgiyylskkzkxlbnf.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

if (!SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
  console.error('Faltan variables de entorno SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET o GMAIL_REFRESH_TOKEN');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    type: 'OAuth2',
    user: GMAIL_USER,
    clientId: GMAIL_CLIENT_ID,
    clientSecret: GMAIL_CLIENT_SECRET,
    refreshToken: GMAIL_REFRESH_TOKEN
  }
});

function hoyArgentina() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

function fmtMoneda(n) {
  return Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
}

// El workflow arranca unos minutos antes (GitHub suele demorar las ejecuciones programadas);
// si todavia no son las 8:00 de Argentina (11:00 UTC), espera hasta esa hora para enviar.
async function esperarHasta8() {
  const ahora = new Date();
  const objetivo = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), 11, 0, 0));
  const ms = objetivo - ahora;
  if (ms > 0 && ms <= 30 * 60 * 1000) {
    console.log('Esperando hasta las 8:00 (Argentina):', Math.round(ms / 1000), 'segundos');
    await new Promise(r => setTimeout(r, ms));
  }
}

function horaArgentina() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false }).format(new Date()));
}

async function main() {
  await esperarHasta8();
  // Los recordatorios son solo de la manana: si una ejecucion programada llega despues del mediodia, no se envia.
  if (process.env.GITHUB_EVENT_NAME === 'schedule' && horaArgentina() >= 12) {
    console.log('Ya pasó el mediodía (Argentina). No se envía el recordatorio fuera de la mañana.');
    return;
  }
  const hoy = hoyArgentina();
  console.log('Buscando pagos con vencimiento:', hoy);

const { data: gastos, error: errG } = await supa
  .from('gastos')
  .select('*, proveedores(nombre)')
  .eq('fecha_pago', hoy)
  .is('forma_pago', null);

if (errG) { console.error('Error consultando gastos:', errG); process.exit(1); }

if (!gastos || gastos.length === 0) {
  console.log('No hay pagos pendientes para hoy. No se envia nada.');
  return;
}

const { data: proyectos, error: errPr } = await supa.from('proyectos').select('id, nombre');
  if (errPr) { console.error('Error consultando proyectos:', errPr); process.exit(1); }

const { data: profiles, error: errP } = await supa.from('profiles').select('email, proyecto_id');
  if (errP) { console.error('Error consultando profiles:', errP); process.exit(1); }

const porProyecto = {};
  for (const g of gastos) {
    (porProyecto[g.proyecto_id] ||= []).push(g);
  }

let fallos = 0;
for (const [proyectoId, lista] of Object.entries(porProyecto)) {
  const proyecto = proyectos.find(p => p.id === proyectoId);
  const nombreProyecto = proyecto ? proyecto.nombre : 'tu establecimiento';
  const destinatarios = profiles.filter(p => p.proyecto_id === proyectoId && p.email).map(p => p.email);

  if (destinatarios.length === 0) {
    console.log('Proyecto ' + nombreProyecto + ' tiene pagos pero ningun usuario con email asignado.');
    continue;
  }

  const filas = lista.map(g => {
    const proveedor = (g.proveedores && g.proveedores.nombre) || g.tipo_gasto || 'Sin proveedor';
    return '- ' + proveedor + ': ' + fmtMoneda(g.total);
  }).join('\n');

  const texto = 'Buenos dias!\n\nBrocoli te recuerda los pagos que tienen vencimiento hoy:\n\n' + filas + '\n\nMuchas gracias!\n\nBrocoli PMS';

  const logoUrl = 'https://raw.githubusercontent.com/diegolsarno/diego-gastro-2-0/main/brocoli-logo-original.png';

  const html = '<p>Buenos dias!</p><p>Brocoli te recuerda los pagos que tienen vencimiento hoy:</p><ul>' + lista.map(g => {
    const proveedor = (g.proveedores && g.proveedores.nombre) || g.tipo_gasto || 'Sin proveedor';
    return '<li>' + proveedor + ': <b>' + fmtMoneda(g.total) + '</b></li>';
  }).join('') + '</ul><p>Muchas gracias!</p><p>Brocoli PMS</p><p><img src="' + logoUrl + '" alt="Brocoli PMS" width="90" style="display:block;margin-top:8px;border:0;"></p>';

  let enviado = false;
  for (let intento = 1; intento <= 3 && !enviado; intento++) {
    try {
      await transporter.sendMail({
        from: '"Brocoli PMS" <' + GMAIL_USER + '>',
        to: destinatarios.join(', '),
        subject: 'Recordatorio de pagos de hoy - ' + nombreProyecto,
        text: texto,
        html
      });
      enviado = true;
      console.log('Mail enviado para ' + nombreProyecto + ' a:', destinatarios.join(', '));
    } catch (e) {
      console.error('Error enviando mail para ' + nombreProyecto + ' (intento ' + intento + ' de 3):', e.message);
      if (intento < 3) await new Promise(r => setTimeout(r, 20000));
    }
  }
  if (!enviado) fallos++;
}

// Si algun envio fallo, la ejecucion termina con error: GitHub no la cuenta como exitosa
// y la siguiente ejecucion de la manana vuelve a intentarlo.
if (fallos > 0) {
  console.error('No se pudo enviar ' + fallos + ' recordatorio(s). Se reintenta en la proxima ejecucion de la manana.');
  process.exit(1);
}
}

main().catch(e => { console.error(e); process.exit(1); });
