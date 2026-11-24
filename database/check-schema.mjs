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
const strip = (sql) => sql.replaceAll(/--[^\n]*/g, '');

// Normaliza espacios y quita los que rodean a "(", ")" y "," (sin expresiones regulares costosas).
function norm(text) {
  let t = text.split(/\s+/).filter(Boolean).join(' ');
  for (const p of ['(', ')', ',']) t = t.replaceAll(` ${p}`, p).replaceAll(`${p} `, p);
  return t.trim().toLowerCase();
}

// Normaliza un CHECK para que "x BETWEEN 1 AND 2" y "x IS NULL OR x BETWEEN 1 AND 2" se consideren iguales:
// elimina los trozos "<palabra> is null or".
function simplify(check) {
  const words = check.split(' ');
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i + 1] === 'is' && words[i + 2] === 'null' && words[i + 3] === 'or') i += 3;
    else out.push(words[i]);
  }
  return out.join(' ');
}

// Devuelve la posición del ")" que cierra el "(" de la posición "open".
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return text.length;
}

// Parte el cuerpo de un CREATE TABLE en definiciones separadas por comas de nivel 0.
function splitTop(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// Contenido de cada CHECK ( ... ) que aparece en una definición de columna.
function checksOf(def) {
  const found = [];
  const lower = def.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf('check', from); at !== -1; at = lower.indexOf('check', from)) {
    const open = lower.indexOf('(', at);
    if (open === -1 || lower.slice(at + 5, open).trim() !== '') { from = at + 5; continue; }
    const close = closingParen(def, open);
    found.push(norm(def.slice(open + 1, close)));
    from = close;
  }
  return found;
}

// Una columna: tipo, NOT NULL y CHECKs. Una restricción de tabla (UNIQUE, CHECK...) se devuelve aparte.
function parseDefinition(def) {
  const words = def.split(/\s+/);
  const first = words[0].toLowerCase();
  if (['unique', 'check', 'primary', 'constraint'].includes(first)) return { constraint: norm(def) };
  const type = (words[1] || '').toLowerCase();
  return { name: first, checks: checksOf(def), notNull: /not null/i.test(def), type: type.split('(')[0] };
}

function parseTables(s) {
  const tables = {};
  const re = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(/gi;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const close = closingParen(s, re.lastIndex - 1);
    const cols = {};
    const tableChecks = [];
    for (const def of splitTop(s.slice(re.lastIndex, close))) {
      const d = parseDefinition(def);
      if (d.constraint) tableChecks.push(d.constraint);
      else cols[d.name] = { checks: d.checks, notNull: d.notNull, type: d.type };
    }
    tables[m[1].toLowerCase()] = { cols, table_checks: tableChecks };
  }
  return tables;
}

function parseIndexes(s) {
  const indexes = {};
  for (const x of s.matchAll(/CREATE (UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)/gi)) {
    indexes[x[2].toLowerCase()] = { unique: !!x[1], table: x[3].toLowerCase(), cols: norm(x[4]) };
  }
  return indexes;
}

function parseEnums(s) {
  const enums = {};
  for (const x of s.matchAll(/CREATE TYPE (\w+) AS ENUM\s*\(([^)]*)\)/gi)) {
    enums[x[1].toLowerCase()] = x[2].split(',').map((v) => v.trim().replaceAll("'", '')).sort().join('|');
  }
  return enums;
}

function parse(sql) {
  const s = strip(sql);
  return { tables: parseTables(s), indexes: parseIndexes(s), enums: parseEnums(s) };
}

// Valores de un CHECK (col IN ('a','b')) de SQLite, como texto ordenado "a|b".
function inListValues(checks) {
  for (const c of checks) {
    const at = c.indexOf('in(');
    if (at !== -1 && c.endsWith(')')) return c.slice(at + 3, -1).split(',').map((v) => v.replaceAll("'", '')).sort().join('|');
  }
  return '';
}

const sq = parse(sqliteSql);
const pg = parse(read('database/postgres/schema.sql'));
const joined = (list) => list.map(simplify).sort().join('|');

// Compara una columna que existe en ambos motores y devuelve los errores encontrados.
function compareColumn(t, c, a, b) {
  const errs = [];
  let ca = joined(a.checks);
  let cb = joined(b.checks);
  const enumValues = pg.enums[b.type];
  if (enumValues) {
    // Enum de PostgreSQL == CHECK (col IN (...)) de SQLite: se comparan los valores.
    const vals = inListValues(a.checks);
    if (vals !== enumValues) errs.push(`${t}.${c}: valores del enum distintos → SQLite [${vals}] vs PostgreSQL [${enumValues}].`);
    ca = '';
    cb = '';
  }
  if (ca !== cb) errs.push(`${t}.${c}: CHECK distinto → SQLite [${ca || 'ninguno'}] vs PostgreSQL [${cb || 'ninguno'}].`);
  if (a.notNull !== b.notNull) errs.push(`${t}.${c}: NOT NULL distinto (SQLite ${a.notNull}, PostgreSQL ${b.notNull}).`);
  return errs;
}

function compareTable(t) {
  const a = sq.tables[t].cols;
  const b = pg.tables[t].cols;
  const errs = [];
  for (const c of Object.keys(a)) {
    if (LOCAL_ONLY.columns.includes(c)) continue;
    if (b[c]) errs.push(...compareColumn(t, c, a[c], b[c]));
    else errs.push(`${t}.${c}: está en SQLite pero falta en PostgreSQL.`);
  }
  for (const c of Object.keys(b)) {
    if (!a[c]) errs.push(`${t}.${c}: está en PostgreSQL pero falta en SQLite.`);
  }
  const ta = joined(sq.tables[t].table_checks);
  const tb = joined(pg.tables[t].table_checks);
  if (ta !== tb) errs.push(`${t}: restricciones de tabla distintas → SQLite [${ta}] vs PostgreSQL [${tb}].`);
  return errs;
}

function compareIndexes() {
  const errs = [];
  for (const [name, idx] of Object.entries(sq.indexes)) {
    if (LOCAL_ONLY.indexes.includes(name)) continue;
    const other = pg.indexes[name];
    if (!other) errs.push(`Índice "${name}": está en SQLite pero falta en PostgreSQL.`);
    else if (idx.cols !== other.cols || idx.unique !== other.unique) errs.push(`Índice "${name}": columnas o unicidad distintas.`);
  }
  for (const name of Object.keys(pg.indexes)) {
    if (!sq.indexes[name]) errs.push(`Índice "${name}": está en PostgreSQL pero falta en SQLite.`);
  }
  return errs;
}

for (const t of Object.keys(pg.tables)) {
  if (!sq.tables[t]) errors.push(`Falta la tabla "${t}" en SQLite.`);
}
for (const t of Object.keys(sq.tables)) {
  if (LOCAL_ONLY.tables.includes(t)) continue;
  if (pg.tables[t]) errors.push(...compareTable(t));
  else errors.push(`Falta la tabla "${t}" en PostgreSQL.`);
}
errors.push(...compareIndexes());

// ---- 3) La migración inicial del backend es copia exacta del esquema de PostgreSQL ----
if (read('backend/migrations/001_init.sql') !== read('database/postgres/schema.sql')) {
  errors.push('backend/migrations/001_init.sql no es igual a database/postgres/schema.sql (cópialo: cp database/postgres/schema.sql backend/migrations/001_init.sql).');
}

if (errors.length) {
  console.error(`✗ ${errors.length} diferencia(s):\n - ` + errors.join('\n - '));
  process.exit(1);
}
console.log('✓ schema.js == sqlite/schema.sql, y SQLite == PostgreSQL (salvo lo declarado como solo-local).');
