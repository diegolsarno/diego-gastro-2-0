import { createClient } from '@supabase/supabase-js';
import { gzipSync } from 'node:zlib';

const SUPABASE_URL = 'https://idcndgiyylskkzkxlbnf.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'backups';

if (!SERVICE_ROLE_KEY) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY');
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

  const { error: eb } = await supa.storage.createBucket(BUCKET, { public: false });
  if (eb && !/already exists|duplicate/i.test(eb.message)) throw eb;
  const { error: eu } = await supa.storage.from(BUCKET).upload(nombreArchivo, contenido, { upsert: true, contentType: 'application/octet-stream' });
  if (eu) throw eu;
  console.log('Backup guardado: ' + BUCKET + '/' + nombreArchivo + ' (' + contenido.length + ' bytes)');
  console.log(resumen.join('\n'));

  // Conserva solo los ultimos 10
  const { data: lista, error: el } = await supa.storage.from(BUCKET).list('', { limit: 1000 });
  if (el) throw el;
  const viejos = lista.map(f => f.name).filter(n => n.startsWith('backup-brocoli-')).sort().reverse().slice(10);
  if (viejos.length) await supa.storage.from(BUCKET).remove(viejos);
}

main().catch(e => { console.error(e); process.exit(1); });
