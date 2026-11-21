// Ruta "/history" (pestaña Historial): calendario + detalle del día elegido.
// Los datos salen de la base de datos (tabla dose_logs). Al tocar un medicamento se despliega
// una tarjeta con las tomas de ese día y su frecuencia.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header, Card, Badge } from '../../src/components/UI';
import { colors, font } from '../../src/theme';
import { fmtTime } from '../../src/services/schedule';
import { dayKey, fmtInterval, parseDayKey } from '../../src/utils/time';
import { getMonthMarks, getHistoryDay } from '../../src/db/repository';
import { useApp } from '../../src/context/AppContext';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// Texto, etiqueta y color de una toma según su estado.
function describe(d, now) {
  const snooze =
    d.snoozeCount > 0
      ? `Aplazada ${d.snoozeCount} ${d.snoozeCount === 1 ? 'vez' : 'veces'}: ${fmtTime(d.scheduledAt)} → ${fmtTime(d.postponedTo ?? d.dueAt)}`
      : null;
  if (d.status === 'taken') {
    return {
      title: `Tomada a las ${fmtTime(d.actionAt)}`,
      tag: d.onTime ? 'A tiempo' : 'Con retraso',
      tagColor: d.onTime ? colors.primaryDark : colors.warn,
      tagBg: d.onTime ? colors.primaryLight : colors.warnBg,
      extra: [d.doseTaken ? `Dosis tomada: ${d.doseTaken}` : null, snooze].filter(Boolean),
    };
  }
  if (d.status === 'skipped') {
    return {
      title: `Omitida a las ${fmtTime(d.actionAt)}${d.autoSkipped ? ' (automática)' : ''}`,
      tag: 'Omitida', tagColor: colors.muted, tagBg: '#EEEEEE',
      extra: [snooze].filter(Boolean),
    };
  }
  if (d.snoozeCount > 0 && d.dueAt > now) {
    return { title: `Aplazada hasta las ${fmtTime(d.dueAt)}`, tag: 'Aplazada', tagColor: colors.primaryDark, tagBg: colors.primaryLight, extra: [snooze] };
  }
  return { title: 'Sin respuesta', tag: 'Sin registro', tagColor: colors.muted, tagBg: '#EEEEEE', extra: [snooze].filter(Boolean) };
}

export default function HistoryScreen() {
  const { todayDoses } = useApp(); // se usa solo para recargar cuando cambia algo hoy
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState(dayKey(Date.now()));
  const [marks, setMarks] = useState([]);
  const [data, setData] = useState([]);
  const [open, setOpen] = useState({});

  // Recarga marcas del mes y datos del día cada vez que se entra a la pestaña o cambian los datos.
  const load = useCallback(async () => {
    setMarks(await getMonthMarks(cursor.year, cursor.month));
    setData(await getHistoryDay(selected));
  }, [cursor, selected, todayDoses]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const changeMonth = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  // Celdas del calendario (semana empieza en lunes).
  const first = new Date(cursor.year, cursor.month, 1);
  const offset = (first.getDay() + 6) % 7;
  const total = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthLabel = first.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const selectedLabel = new Date(parseDayKey(selected)).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const todayKey = dayKey(Date.now());
  const now = Date.now();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Historial" subtitle="Elige un día para ver tus tomas" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {/* Calendario */}
        <Card>
          <View style={s.monthRow}>
            <TouchableOpacity onPress={() => changeMonth(-1)} style={s.nav} accessibilityLabel="Mes anterior">
              <Ionicons name="chevron-back" size={26} color={colors.primary} />
            </TouchableOpacity>
            <Text style={s.month}>{monthLabel}</Text>
            <TouchableOpacity onPress={() => changeMonth(1)} style={s.nav} accessibilityLabel="Mes siguiente">
              <Ionicons name="chevron-forward" size={26} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <View style={s.week}>
            {WEEKDAYS.map((w) => <Text key={w} style={s.weekday}>{w}</Text>)}
          </View>
          {weeks.map((wk, wi) => (
            <View key={wi} style={s.week}>
              {wk.map((day, di) => {
                if (!day) return <View key={di} style={s.cell} />;
                const key = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isSel = key === selected;
                return (
                  <TouchableOpacity key={di} style={s.cell} onPress={() => { setSelected(key); setOpen({}); }} accessibilityLabel={`Día ${day}`}>
                    <View style={[s.day, key === todayKey && { borderColor: colors.primary }, isSel && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                      <Text style={[s.dayText, isSel && { color: colors.white }]}>{day}</Text>
                    </View>
                    <View style={[s.dot, marks.includes(key) && { backgroundColor: isSel ? colors.primaryDark : colors.primary }]} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </Card>

        {/* Detalle del día */}
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
                          <Text style={s.doseTime}>{fmtTime(d.scheduledAt)}</Text>
                          <Badge text={info.tag} color={info.tagColor} bg={info.tagBg} />
                        </View>
                        <Text style={s.doseTitle}>{info.title}</Text>
                        {info.extra.map((t, i) => <Text key={i} style={s.doseExtra}>{t}</Text>)}
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  nav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 19, fontWeight: '800', color: colors.primaryDark, textTransform: 'capitalize' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '800', color: colors.muted, paddingVertical: 6 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  day: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 16, fontWeight: '700', color: colors.text },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'transparent', marginTop: 2 },
  dayTitle: { fontSize: 19, fontWeight: '800', color: colors.primaryDark, marginVertical: 8, textTransform: 'capitalize' },
  empty: { fontSize: font.body, color: colors.muted, textAlign: 'center', paddingVertical: 8 },
  medHead: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  medName: { fontSize: 20, fontWeight: '800', color: colors.text },
  medSub: { fontSize: 15, color: colors.muted, marginTop: 2 },
  detail: { marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: colors.primaryLight },
  detailLine: { fontSize: 15, color: colors.primaryDark, fontWeight: '600', marginBottom: 4 },
  dose: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.primaryMid },
  doseHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  doseTime: { fontSize: font.body, fontWeight: '800', color: colors.text },
  doseTitle: { fontSize: 15, color: colors.text },
  doseExtra: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
