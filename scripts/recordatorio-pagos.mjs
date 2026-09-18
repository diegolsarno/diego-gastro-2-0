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

async function main() {
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

    const html = '<p>Buenos dias!</p><p>Brocoli te recuerda los pagos que tienen vencimiento hoy:</p><ul>' + lista.map(g => {
      const proveedor = (g.proveedores && g.proveedores.nombre) || g.tipo_gasto || 'Sin proveedor';
      return '<li>' + proveedor + ': <b>' + fmtMoneda(g.total) + '</b></li>';
    }).join('') + '</ul><p>Muchas gracias!</p><p>Brocoli PMS</p>';

    try {
      await transporter.sendMail({
        from: '"Brocoli PMS" <' + GMAIL_USER + '>',
        to: destinatarios.join(', '),
        subject: 'Recordatorio de pagos de hoy - ' + nombreProyecto,
        text: texto,
        html
      });
      console.log('Mail enviado para ' + nombreProyecto + ' a:', destinatarios.join(', '));
    } catch (e) {
      console.error('Error enviando mail para ' + nombreProyecto + ':', e.message);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
