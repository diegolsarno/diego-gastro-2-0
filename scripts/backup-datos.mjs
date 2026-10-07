import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { gzipSync } from 'node:zlib';

const SUPABASE_URL = 'https://idcndgiyylskkzkxlbnf.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const DESTINO = process.env.BACKUP_DESTINO || GMAIL_USER;

if (!SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
  console.error('Faltan variables de entorno');
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Lista de tablas: se descubre sola, asi una tabla nueva entra al backup sin tocar este archivo.
async function listarTablas() {
  const r = await fetch(SUPABASE_URL + '/rest/v1/', { headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY } });
  if (!r.ok) throw new Error('No se pudo listar las tablas: HTTP ' + r.status);
  const spec = await r.json();
  const tablas = Object.keys(spec.definitions || {}).sort();
  if (tablas.length === 0) throw new Error('No se encontraron tablas');
  return tablas;
}

async function bajarTabla(nombre) {
  const filas = [];
  const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await supa.from(nombre).select('*').range(desde, desde + paso - 1);
    if (error) throw new Error(nombre + ': ' + error.message);
    filas.push(...data);
    if (data.length < paso) break;
  }
  return filas;
}

function hoyArgentina() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function main() {
  const tablas = await listarTablas();
  const backup = { fecha: new Date().toISOString(), tablas: {} };
  const resumen = [];
  for (const t of tablas) {
    const filas = await bajarTabla(t);
    backup.tablas[t] = filas;
    resumen.push(t + ': ' + filas.length + ' filas');
    console.log(t + ': ' + filas.length + ' filas');
  }

  const fecha = hoyArgentina();
  let contenido = Buffer.from(JSON.stringify(backup));
  let nombreArchivo = 'backup-brocoli-' + fecha + '.json';
  if (contenido.length > 15 * 1024 * 1024) {
    contenido = gzipSync(contenido);
    nombreArchivo += '.gz';
  }
  if (contenido.length > 24 * 1024 * 1024) throw new Error('El backup pesa mas de 24 MB, no entra como adjunto de Gmail');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { type: 'OAuth2', user: GMAIL_USER, clientId: GMAIL_CLIENT_ID, clientSecret: GMAIL_CLIENT_SECRET, refreshToken: GMAIL_REFRESH_TOKEN }
  });

  await transporter.sendMail({
    from: '"Brocoli PMS" <' + GMAIL_USER + '>',
    to: DESTINO,
    subject: 'Backup de datos Brocoli PMS - ' + fecha,
    text: 'Backup diario de los datos de la app (' + fecha + ').\n\nContenido:\n' + resumen.join('\n') + '\n\nBrocoli PMS',
    attachments: [{ filename: nombreArchivo, content: contenido }]
  });
  console.log('Backup enviado a ' + DESTINO + ' (' + nombreArchivo + ', ' + contenido.length + ' bytes)');
}

main().catch(e => { console.error(e); process.exit(1); });
