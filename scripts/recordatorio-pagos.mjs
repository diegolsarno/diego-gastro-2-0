import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://idcndgiyylskkzkxlbnf.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Brocoli PMS <onboarding@resend.dev>';

if (!SERVICE_ROLE_KEY || !RESEND_API_KEY) {
  console.error('Faltan variables de entorno SUPABASE_SERVICE_ROLE_KEY o RESEND_API_KEY');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: destinatarios,
        subject: 'Recordatorio de pagos de hoy - ' + nombreProyecto,
        text: texto,
        html
      })
    });

    const respBody = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('Error enviando mail para ' + nombreProyecto + ':', respBody);
    } else {
      console.log('Mail enviado para ' + nombreProyecto + ' a:', destinatarios.join(', '));
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
