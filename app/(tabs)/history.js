// Ruta "/history" (pestaña Historial).
// - Arriba: gráfica de barras con el comportamiento de los últimos 7 días (tomadas / omitidas / sin respuesta).
// - Icono de filtro (encabezado): abre un selector de fecha emergente y pequeño (ventana flotante) para elegir otra fecha.
// - Abajo: detalle del día elegido, por medicamento (se despliega al tocarlo).
// Cada vez que se vuelve a esta pestaña, la fecha elegida y el calendario se reinician al día de HOY.
import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Modal, Pressable, Alert } from 'react-native';
import { Text } from '../../src/components/AppText';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header, Card, Badge } from '../../src/components/UI';
import { colors, font, radius } from '../../src/theme';
import { fmtTime } from '../../src/services/schedule';
import { dayKey, fmtInterval, parseDayKey } from '../../src/utils/time';
import { getMonthMarks, getHistoryDay, getWeekSummary } from '../../src/db/repository';
import { useApp } from '../../src/context/AppContext';
import { exportHistoryPdf } from '../../src/services/historyPdf';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const BAR_AREA = 120; // alto máximo de las barras (px)
const C_TAKEN = colors.primary;
const C_SKIPPED = colors.primaryMid; // verde claro (en sintonía con la paleta)
const C_MISSED = '#CFD8DC';

const GRAY = { tagColor: colors.muted, tagBg: '#EEEEEE' };
const GREEN = { tagColor: colors.primaryDark, tagBg: colors.primaryLight };
const LATE = { tagColor: colors.leaf, tagBg: colors.leafBg };

// "Aplazada 2 veces: 08:00 → 08:20" (o null si no se aplazó).
function snoozeLine(d) {
  if (d.snoozeCount <= 0) return null;
  const times = d.snoozeCount === 1 ? 'vez' : 'veces';
  const from = fmtTime(d.plannedAt);
  const to = fmtTime(d.postponedTo ?? d.dueAt);
  return `Aplazada ${d.snoozeCount} ${times}: ${from} → ${to}`;
}

function describeTaken(d, snooze) {
  const colorsOf = d.onTime ? GREEN : LATE;
  return {
    title: `Tomada a las ${fmtTime(d.actionAt)}`,
    tag: d.onTime ? 'A tiempo' : 'Con retraso',
    ...colorsOf,
    extra: [d.doseTaken ? `Dosis tomada: ${d.doseTaken}` : null, snooze].filter(Boolean),
  };
}

function describeSkipped(d, snooze) {
  const auto = d.autoSkipped ? ' (automática)' : '';
  return { title: `Omitida a las ${fmtTime(d.actionAt)}${auto}`, tag: 'Omitida', ...GRAY, extra: [snooze].filter(Boolean) };
}

// Texto, etiqueta y color de una toma según su estado.
function describe(d, now) {
  const snooze = snoozeLine(d);
  if (d.status === 'taken') return describeTaken(d, snooze);
  if (d.status === 'skipped') return describeSkipped(d, snooze);
  if (d.snoozeCount > 0 && d.dueAt > now) {
    return { title: `Aplazada hasta las ${fmtTime(d.dueAt)}`, tag: 'Aplazada', ...GREEN, extra: [snooze] };
  }
  return { title: 'Sin respuesta', tag: 'Sin registro', ...GRAY, extra: [snooze].filter(Boolean) };
}

// Semanas del calendario del mes (la semana empieza en lunes). Cada celda lleva su propia clave estable.
function buildWeeks(year, month) {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const mm = String(month + 1).padStart(2, '0');
  const cells = [];
  for (let n = 0; n < offset; n++) cells.push({ id: `${year}-${mm}-pre${n}`, day: null });
  for (let day = 1; day <= total; day++) {
    const dd = String(day).padStart(2, '0');
    cells.push({ id: `${year}-${mm}-${dd}`, key: `${year}-${mm}-${dd}`, day });
  }
  const trailing = (7 - (cells.length % 7)) % 7; // celdas vacías para completar la última semana
  for (let n = 0; n < trailing; n++) cells.push({ id: `${year}-${mm}-post${n}`, day: null });
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push({ id: cells[i].id, cells: cells.slice(i, i + 7) });
  return weeks;
}

export default function HistoryScreen() {
  const { todayDoses, profile } = useApp(); // solo para recargar cuando cambia algo hoy
  const todayKey = dayKey(Date.now());
  const now0 = new Date();

  const [selected, setSelected] = useState(todayKey);
  const [cursor, setCursor] = useState({ year: now0.getFullYear(), month: now0.getMonth() });
  const [calOpen, setCalOpen] = useState(false);
  const [open, setOpen] = useState({});
  const [tick, setTick] = useState(0);
  const [week, setWeek] = useState([]);
  const [marks, setMarks] = useState([]);
  const [data, setData] = useState([]);

  // Al volver a la pestaña: todo se reinicia al día de hoy y el calendario se cierra.
  useFocusEffect(
    useCallback(() => {
      const d = new Date();
      setSelected(dayKey(d.getTime()));
      setCursor({ year: d.getFullYear(), month: d.getMonth() });
      setCalOpen(false);
      setOpen({});
      setTick((t) => t + 1);
    }, [])
  );

  // Datos de la gráfica semanal.
  useEffect(() => { getWeekSummary(7).then(setWeek).catch(() => {}); }, [todayDoses, tick]);
  // Puntos del calendario (días con registros del mes mostrado).
  useEffect(() => { getMonthMarks(cursor.year, cursor.month).then(setMarks).catch(() => {}); }, [cursor, todayDoses, tick]);
  // Detalle del día elegido.
  useEffect(() => { getHistoryDay(selected).then(setData).catch(() => {}); }, [selected, todayDoses, tick]);

  // Descargar el historial en PDF: se elige el periodo y se abre el menú de compartir/guardar.
  const [exporting, setExporting] = useState(false);
  const exportPdf = async (days) => {
    setExporting(true);
    try {
      await exportHistoryPdf({ days, profile });
    } catch (e) {
      Alert.alert('No se pudo crear el PDF', e.message);
    } finally {
      setExporting(false);
    }
  };
  const askPeriod = () =>
    Alert.alert('Descargar historial en PDF', 'Elige el periodo que quieres incluir.', [
      { text: 'Últimos 7 días', onPress: () => exportPdf(7) },
      { text: 'Últimos 30 días', onPress: () => exportPdf(30) },
      { text: 'Últimos 90 días', onPress: () => exportPdf(90) },
    ], { cancelable: true });

  const pickDay = (key) => {
    setSelected(key);
    setOpen({});
    setCalOpen(false);
  };

  const changeMonth = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  // Resumen de la semana
  const maxTotal = Math.max(1, ...week.map((d) => d.total));
  const weekTaken = week.reduce((a, d) => a + d.taken, 0);
  const weekTotal = week.reduce((a, d) => a + d.total, 0);
  const pct = weekTotal ? Math.round((weekTaken / weekTotal) * 100) : null;

  // Semanas del calendario del mes mostrado.
  const first = new Date(cursor.year, cursor.month, 1);
  const weeks = buildWeeks(cursor.year, cursor.month);

  const isCurrentMonth = cursor.year === now0.getFullYear() && cursor.month === now0.getMonth();
  const monthLabel = first.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const selectedLabel =
    selected === todayKey
      ? 'Hoy'
      : new Date(parseDayKey(selected)).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const now = Date.now();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        title="Historial"
        subtitle={selected === todayKey ? 'Últimos 7 días' : `Fecha: ${selectedLabel}`}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={askPeriod} disabled={exporting} style={s.filter} accessibilityRole="button" accessibilityLabel="Descargar historial en PDF">
              <Ionicons name={exporting ? 'hourglass-outline' : 'download-outline'} size={26} color={colors.white} />
            </TouchableOpacity>
          <TouchableOpacity onPress={() => setCalOpen((v) => !v)} style={s.filter} accessibilityRole="button" accessibilityLabel="Filtrar por fecha">
            <Ionicons name={calOpen ? 'funnel' : 'funnel-outline'} size={26} color={colors.white} />
            {selected !== todayKey && <View style={s.filterDot} />}
          </TouchableOpacity>
          </View>
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {/* Gráfica de los últimos 7 días */}
        <Card>
          <View style={s.chartHead}>
            <Text style={s.chartTitle}>Últimos 7 días</Text>
            <Text style={s.chartPct}>{pct === null ? '—' : `${pct}%`}</Text>
          </View>
          <Text style={s.chartSub}>
            {weekTotal ? `${weekTaken} de ${weekTotal} tomas realizadas` : 'Aún no hay tomas registradas esta semana'}
          </Text>

          <View style={s.bars}>
            {week.map((d) => {
              const h = (n) => (n / maxTotal) * BAR_AREA;
              const isSel = d.key === selected;
              const label = new Date(d.time).toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '').slice(0, 3);
              return (
                <TouchableOpacity key={d.key} style={s.barCol} onPress={() => pickDay(d.key)} accessibilityRole="button"
                  accessibilityLabel={`${label} ${new Date(d.time).getDate()}: ${d.taken} de ${d.total} tomas realizadas`}>
                  <Text style={s.barCount}>{d.total ? `${d.taken}/${d.total}` : ''}</Text>
                  <View style={[s.barSlot, { height: BAR_AREA }]}>
                    {d.total === 0 ? (
                      <View style={[s.seg, { height: 3, backgroundColor: colors.border }]} />
                    ) : (
                      <View style={[s.stack, isSel && { borderColor: colors.primaryDark }]}>
                        {d.missed > 0 && <View style={[s.seg, { height: h(d.missed), backgroundColor: C_MISSED }]} />}
                        {d.skipped > 0 && <View style={[s.seg, { height: h(d.skipped), backgroundColor: C_SKIPPED }]} />}
                        {d.taken > 0 && <View style={[s.seg, { height: h(d.taken), backgroundColor: C_TAKEN }]} />}
                      </View>
                    )}
                  </View>
                  <Text style={[s.barLabel, isSel && { color: colors.primaryDark, fontWeight: '800' }]}>{label}</Text>
                  <Text style={[s.barDay, isSel && { color: colors.primaryDark, fontWeight: '800' }]}>{new Date(d.time).getDate()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.legend}>
            {[[C_TAKEN, 'Tomadas'], [C_SKIPPED, 'Omitidas'], [C_MISSED, 'Sin respuesta']].map(([c, t]) => (
              <View key={t} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: c }]} />
                <Text style={s.legendText}>{t}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Detalle del día elegido */}
        <Text style={s.dayTitle}>{selectedLabel}</Text>

        {data.length === 0 && (
          <Card>
            <Text style={s.empty}>No hay datos registrados para esta fecha</Text>
          </Card>
        )}

        {data.map((g) => {
          const expanded = !!open[g.medId];
          const taken = g.doses.filter((d) => d.status === 'taken').length;
          return (
            <Card key={g.medId}>
              <TouchableOpacity
                style={s.medHead}
                onPress={() => setOpen((o) => ({ ...o, [g.medId]: !o[g.medId] }))}
                accessibilityRole="button"
                accessibilityLabel={`${g.name}, ${expanded ? 'ocultar' : 'ver'} detalle`}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={s.medName}>{g.name}</Text>
                  <Text style={s.medSub}>{taken} de {g.doses.length} tomas realizadas</Text>
                </View>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={26} color={colors.primary} />
              </TouchableOpacity>

              {expanded && (
                <View style={s.detail}>
                  <Text style={s.detailLine}>Frecuencia: {fmtInterval(g.intervalHours)}</Text>
                  <Text style={s.detailLine}>Dosis: {g.dose}{g.notes ? ` · ${g.notes}` : ''}</Text>
                  {g.doses.map((d) => {
                    const info = describe(d, now);
                    return (
                      <View key={d.id} style={s.dose}>
                        <View style={s.doseHead}>
                          <Text style={s.doseTime}>{fmtTime(d.plannedAt)}</Text>
                          <Badge text={info.tag} color={info.tagColor} bg={info.tagBg} />
                        </View>
                        <Text style={s.doseTitle}>{info.title}</Text>
                        {info.extra.map((t) => <Text key={t} style={s.doseExtra}>{t}</Text>)}
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>

      {/* Selector de fecha emergente: ventana pequeña y centrada sobre un fondo atenuado */}
      <Modal transparent visible={calOpen} animationType="fade" onRequestClose={() => setCalOpen(false)} statusBarTranslucent>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCalOpen(false)} accessibilityLabel="Cerrar selector de fecha" />
          <View style={s.popup}>
            <View style={s.monthRow}>
              <TouchableOpacity onPress={() => changeMonth(-1)} style={s.nav} accessibilityLabel="Mes anterior">
                <Ionicons name="chevron-back" size={24} color={colors.primary} />
              </TouchableOpacity>
              <Text style={s.month}>{monthLabel}</Text>
              <TouchableOpacity onPress={() => changeMonth(1)} disabled={isCurrentMonth} style={[s.nav, isCurrentMonth && { opacity: 0.25 }]} accessibilityLabel="Mes siguiente">
                <Ionicons name="chevron-forward" size={24} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={s.week}>
              {WEEKDAYS.map((w) => <Text key={w} style={s.weekday}>{w}</Text>)}
            </View>
            {weeks.map((wk) => (
              <View key={wk.id} style={s.week}>
                {wk.cells.map((cell) => {
                  if (!cell.day) return <View key={cell.id} style={s.cell} />;
                  const { key, day } = cell;
                  const isSel = key === selected;
                  const future = key > todayKey; // no hay historial de días futuros
                  return (
                    <TouchableOpacity key={cell.id} style={s.cell} disabled={future} onPress={() => pickDay(key)} accessibilityLabel={`Día ${day}`}>
                      <View style={[s.day, key === todayKey && { borderColor: colors.primary }, isSel && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                        <Text style={[s.dayText, isSel && { color: colors.white }, future && { color: '#B8C4BA' }]}>{day}</Text>
                      </View>
                      <View style={[s.dot, marks.includes(key) && { backgroundColor: isSel ? colors.primaryDark : colors.primary }]} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            <View style={s.popupActions}>
              <TouchableOpacity onPress={() => setCalOpen(false)} style={s.actionBtn} accessibilityRole="button">
                <Text style={[s.todayText, { color: colors.muted }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => pickDay(todayKey)} style={s.actionBtn} accessibilityRole="button">
                <Text style={s.todayText}>Hoy</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  filter: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  filterDot: { position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFEB3B', borderWidth: 1, borderColor: colors.primary },
  // Selector de fecha emergente
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  popup: { width: '100%', maxWidth: 330, backgroundColor: colors.white, borderRadius: radius.lg, padding: 12, elevation: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  popupActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  actionBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  nav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 17, fontWeight: '800', color: colors.primaryDark, textTransform: 'capitalize' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '800', color: colors.muted, paddingVertical: 6 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  day: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 15, fontWeight: '700', color: colors.text },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'transparent', marginTop: 2 },
  todayText: { fontSize: 15, fontWeight: '800', color: colors.primary },
  // Gráfica
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chartTitle: { fontSize: 19, fontWeight: '800', color: colors.primaryDark },
  chartPct: { fontSize: 28, fontWeight: '800', color: colors.primary },
  chartSub: { fontSize: 15, color: colors.muted, marginTop: 2, marginBottom: 14 },
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center' },
  barCount: { fontSize: 11, fontWeight: '700', color: colors.muted, height: 16 },
  barSlot: { width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  stack: { width: '62%', borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', justifyContent: 'flex-end' },
  seg: { width: '100%' },
  barLabel: { fontSize: 12, color: colors.muted, marginTop: 6, textTransform: 'capitalize' },
  barDay: { fontSize: 14, color: colors.text, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14, marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  // Detalle
  dayTitle: { fontSize: 19, fontWeight: '800', color: colors.primaryDark, marginVertical: 8, textTransform: 'capitalize' },
  empty: { fontSize: font.body, color: colors.muted, textAlign: 'center', paddingVertical: 8 },
  medHead: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  medName: { fontSize: 20, fontWeight: '800', color: colors.text },
  medSub: { fontSize: 15, color: colors.muted, marginTop: 2 },
  detail: { marginTop: 12, padding: 12, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  detailLine: { fontSize: 15, color: colors.primaryDark, fontWeight: '600', marginBottom: 4 },
  dose: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.primaryMid },
  doseHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  doseTime: { fontSize: font.body, fontWeight: '800', color: colors.text },
  doseTitle: { fontSize: 15, color: colors.text },
  doseExtra: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
