// Verificador de esquemas de MediRecuerda.
//   node database/check-schema.mjs           -> comprueba (sale con error si algo no coincide)
//   node database/check-schema.mjs --write   -> regenera database/sqlite/schema.sql desde src/db/schema.js
//
// Comprueba dos cosas:
//  1) database/sqlite/schema.sql es IDÉNTICO al texto SQL de src/db/schema.js.
//  2) SQLite y PostgreSQL tienen las mismas tablas, columnas, restricciones CHECK e índices,
//     salvo las diferencias que están declaradas a propósito en LOCAL_ONLY / SERVER_ONLY.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---- Diferencias permitidas (por diseño) ----
const LOCAL_ONLY = {
  tables: ['app_meta', 'local_credentials'],      // ajustes del teléfono y contraseña local: nunca suben al servidor
  columns: ['synced_at'],                          // marca de sincronización (solo en el teléfono)
  indexes: ['idx_logs_unsynced'],
};
const SERVER_ONLY = { tables: [], columns: [], indexes: [] }; // vistas y enums no se comparan

// ---- 1) schema.js == sqlite/schema.sql ----
const js = read('src/db/schema.js');
const sqliteSql = js.slice(js.indexOf('`') + 1, js.lastIndexOf('`'));
const header = '-- MediRecuerda · Esquema SQLite (copia local). Generado desde src/db/schema.js: no editar a mano.\n';
const expectedFile = header + sqliteSql;
const filePath = path.join(root, 'database/sqlite/schema.sql');

if (process.argv.includes('--write')) {
  fs.writeFileSync(filePath, expectedFile);
  console.log('Regenerado database/sqlite/schema.sql');
}
const errors = [];
if (read('database/sqlite/schema.sql') !== expectedFile) {
  errors.push('database/sqlite/schema.sql NO coincide con src/db/schema.js (ejecuta con --write).');
}

// ---- 2) Paridad SQLite <-> PostgreSQL ----
const strip = (sql) => sql.replace(/--[^\n]*/g, '');
const norm = (s) => s.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim().toLowerCase();

// Parte el cuerpo de un CREATE TABLE en definiciones separadas por comas de nivel 0.
function splitTop(body) {
  const out = []; let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parse(sql) {
  const s = strip(sql);
  const tables = {};
  const re = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(s))) {
    let i = re.lastIndex, depth = 1;
    while (depth > 0) { const c = s[i++]; if (c === '(') depth++; if (c === ')') depth--; }
    const cols = {}, table_checks = [];
    for (const def of splitTop(s.slice(re.lastIndex, i - 1))) {
      const first = def.split(/\s+/)[0].toLowerCase();
      if (['unique', 'check', 'primary', 'constraint'].includes(first)) { table_checks.push(norm(def)); continue; }
      const checks = [...def.matchAll(/CHECK\s*\((.*)\)/gi)].map((x) => norm(x[1]));
      cols[first] = { checks, notNull: /not null/i.test(def), type: (def.split(/\s+/)[1] || '').toLowerCase().replace(/\(.*/, '') };
    }
    tables[m[1].toLowerCase()] = { cols, table_checks };
  }
  const indexes = {};
  for (const x of s.matchAll(/CREATE (UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)/gi)) {
    indexes[x[2].toLowerCase()] = { unique: !!x[1], table: x[3].toLowerCase(), cols: norm(x[4]) };
  }
  const enums = {};
  for (const x of s.matchAll(/CREATE TYPE (\w+) AS ENUM\s*\(([^)]*)\)/gi)) {
    enums[x[1].toLowerCase()] = x[2].split(',').map((v) => v.trim().replace(/'/g, '')).sort().join('|');
  }
  return { tables, indexes, enums };
}

const sq = parse(sqliteSql);
const pg = parse(read('database/postgres/schema.sql'));

// Normaliza un CHECK para que "x BETWEEN 1 AND 2" y "x IS NULL OR x BETWEEN 1 AND 2" se consideren iguales.
const simplify = (c) => c.replace(/\w+ is null or /g, '');

for (const t of Object.keys(pg.tables)) {
  if (!sq.tables[t]) { errors.push(`Falta la tabla "${t}" en SQLite.`); continue; }
}
for (const t of Object.keys(sq.tables)) {
  if (LOCAL_ONLY.tables.includes(t)) continue;
  if (!pg.tables[t]) { errors.push(`Falta la tabla "${t}" en PostgreSQL.`); continue; }
  const a = sq.tables[t].cols, b = pg.tables[t].cols;
  for (const c of Object.keys(a)) {
    if (LOCAL_ONLY.columns.includes(c)) continue;
    if (!b[c]) errors.push(`${t}.${c}: está en SQLite pero falta en PostgreSQL.`);
  }
  for (const c of Object.keys(b)) {
    if (!a[c]) errors.push(`${t}.${c}: está en PostgreSQL pero falta en SQLite.`);
  }
  for (const c of Object.keys(a)) {
    if (!b[c]) continue;
    let ca = a[c].checks.map(simplify).sort().join('|'), cb = b[c].checks.map(simplify).sort().join('|');
    // Enum de PostgreSQL == CHECK (col IN (...)) de SQLite: se comparan los valores.
    if (pg.enums[b[c].type]) {
      const inList = a[c].checks.map((x) => /in\((.*)\)$/.exec(x)).find(Boolean);
      const vals = inList ? inList[1].split(',').map((v) => v.replace(/'/g, '')).sort().join('|') : '';
      if (vals !== pg.enums[b[c].type]) errors.push(`${t}.${c}: valores del enum distintos → SQLite [${vals}] vs PostgreSQL [${pg.enums[b[c].type]}].`);
      ca = cb = '';
    }
    if (ca !== cb) errors.push(`${t}.${c}: CHECK distinto → SQLite [${ca || 'ninguno'}] vs PostgreSQL [${cb || 'ninguno'}].`);
    if (a[c].notNull !== b[c].notNull) errors.push(`${t}.${c}: NOT NULL distinto (SQLite ${a[c].notNull}, PostgreSQL ${b[c].notNull}).`);
  }
  const ta = sq.tables[t].table_checks.map(simplify).sort().join('|'), tb = pg.tables[t].table_checks.map(simplify).sort().join('|');
  if (ta !== tb) errors.push(`${t}: restricciones de tabla distintas → SQLite [${ta}] vs PostgreSQL [${tb}].`);
}
for (const i of Object.keys(sq.indexes)) {
  if (LOCAL_ONLY.indexes.includes(i)) continue;
  if (!pg.indexes[i]) errors.push(`Índice "${i}": está en SQLite pero falta en PostgreSQL.`);
  else if (sq.indexes[i].cols !== pg.indexes[i].cols || sq.indexes[i].unique !== pg.indexes[i].unique)
    errors.push(`Índice "${i}": columnas o unicidad distintas.`);
}
for (const i of Object.keys(pg.indexes)) {
  if (!sq.indexes[i]) errors.push(`Índice "${i}": está en PostgreSQL pero falta en SQLite.`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} diferencia(s):\n - ` + errors.join('\n - '));
  process.exit(1);
}
console.log('✓ schema.js == sqlite/schema.sql, y SQLite == PostgreSQL (salvo lo declarado como solo-local).');
