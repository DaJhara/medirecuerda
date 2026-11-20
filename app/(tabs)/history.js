// Ruta "/history" (pestaña Historial): adherencia de los últimos 7 días.
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Header, Card } from '../../src/components/UI';
import { colors, font } from '../../src/theme';
import { dosesOfDay } from '../../src/services/schedule';
import { useApp } from '../../src/context/AppContext';

export default function HistoryScreen() {
  const { meds, log } = useApp();
  const now = Date.now();
  const days = [];
  let totalPast = 0;
  let totalTaken = 0;

  // Recorre hoy y los 6 días anteriores.
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const doses = dosesOfDay(meds, date).filter((d) => d.time <= now); // solo tomas ya vencidas
    const taken = doses.filter((d) => log[d.key]?.status === 'taken').length;
    totalPast += doses.length;
    totalTaken += taken;
    days.push({
      label: date.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' }),
      total: doses.length,
      taken,
    });
  }

  const pct = totalPast ? Math.round((totalTaken / totalPast) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Historial" subtitle="Últimos 7 días" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        <Card style={{ backgroundColor: colors.primaryLight, borderColor: colors.primaryMid, alignItems: 'center' }}>
          <Text style={s.big}>{totalPast ? `${pct}%` : '—'}</Text>
          <Text style={s.sub}>
            {totalPast ? `Adherencia: ${totalTaken} de ${totalPast} tomas confirmadas` : 'Aún no hay tomas vencidas para calcular'}
          </Text>
        </Card>

        {days.map((d, i) => (
          <Card key={i}>
            <View style={s.row}>
              <Text style={s.day}>{d.label}</Text>
              <Text style={s.count}>{d.total ? `${d.taken}/${d.total}` : 'Sin tomas'}</Text>
            </View>
            {d.total > 0 && (
              <View style={s.track}>
                <View style={[s.fill, { width: `${(d.taken / d.total) * 100}%` }]} />
              </View>
            )}
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 48, fontWeight: '800', color: colors.primary },
  sub: { fontSize: font.body, color: colors.primaryDark, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  day: { fontSize: font.body, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
  count: { fontSize: font.body, color: colors.muted, fontWeight: '700' },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.primaryLight, overflow: 'hidden' },
  fill: { height: 10, backgroundColor: colors.primary },
});
