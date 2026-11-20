// Ruta "/" (pestaña Hoy): tomas del día con acciones Tomé / Aplazar / Omitir.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Header, Card, Button, Badge } from '../../src/components/UI';
import { colors, font } from '../../src/theme';
import { dosesOfDay, fmtTime } from '../../src/services/schedule';
import { useApp } from '../../src/context/AppContext';

export default function TodayScreen() {
  const router = useRouter();
  const { meds, log, setStatus, clearStatus, snooze } = useApp();
  const onAdd = () => router.push('/med-form');
  // "now" se actualiza cada 30 s para marcar las tomas atrasadas.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const dayKey = new Date(now).toDateString();
  const doses = useMemo(() => dosesOfDay(meds, new Date()), [meds, dayKey]);
  const done = doses.filter((d) => log[d.key]?.status === 'taken').length;

  const dateLabel = new Date(now).toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Hoy" subtitle={dateLabel} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {doses.length > 0 && (
          <Card style={{ backgroundColor: colors.primaryLight, borderColor: colors.primaryMid }}>
            <Text style={s.summary}>
              {done} de {doses.length} tomas realizadas
            </Text>
          </Card>
        )}

        {doses.length === 0 && (
          <Card>
            <Text style={s.emptyTitle}>No tienes tomas programadas hoy</Text>
            <Text style={s.emptyText}>
              Agrega tus medicamentos manualmente o escanea tu orden médica con IA.
            </Text>
            <Button title="Agregar medicamento" onPress={onAdd} />
          </Card>
        )}

        {doses.map((d) => {
          const entry = log[d.key];
          const snoozedUntil = entry?.status === 'snoozed' ? entry.until : null;
          const availableTime = snoozedUntil || d.time;
          const late = !entry || entry.status === 'snoozed'
            ? availableTime <= now
            : false;

          const completed = entry && entry.status !== 'snoozed';

          return (
            <Card key={d.key} style={entry?.status === 'taken' ? { borderColor: colors.primaryMid, backgroundColor: '#F6FBF6' } : undefined}>
              <View style={s.row}>
                <Text style={s.time}>
                  {fmtTime(
                    entry?.status === 'snoozed' && entry.until
                      ? entry.until
                      : d.time
                  )}
                </Text>
                  {entry?.status === 'taken' && (
                    <Badge text={`Tomada · ${fmtTime(entry.at)}`} />
                  )}

                  {entry?.status === 'skipped' && (
                    <Badge text="Omitida" color={colors.muted} bg="#EEEEEE" />
                  )}

                  {entry?.status === 'snoozed' && !late && (
                    <Badge text="Aplazada" color={colors.primaryDark} bg={colors.primaryLight} />
                  )}

                  {entry?.status === 'snoozed' && late && (
                    <Badge text="Atrasada" color={colors.warn} bg={colors.warnBg} />
                  )}

                  {!entry && late && (
                    <Badge text="Atrasada" color={colors.warn} bg={colors.warnBg} />
                  )}

                  {!entry && !late && (
                    <Badge text="Pendiente" />
                  )}
              </View>
              <Text style={s.name}>{d.med.name}</Text>
              <Text style={s.dose}>
                {d.med.dose}
                {d.med.notes ? ` · ${d.med.notes}` : ''}
              </Text>

              {!completed ? (
                <View style={s.actions}>
                  <Button
                    title="Tomé"
                    disabled={!late}
                    onPress={() => setStatus(d.key, 'taken')}
                    style={{ flex: 1.2 }}
                  />
                  <Button
                    title="Aplazar"
                    variant="outline"
                    disabled={!late}
                    onPress={() => {
                      const until = Date.now() + 10 * 60 * 1000;

                      // El cambio de estado activa rescheduleAll().
                      // Esta función programará el nuevo recordatorio.
                      setStatus(d.key, 'snoozed', until);

                      Alert.alert(
                        'Aplazado',
                        'Te lo recordaremos en 10 minutos.'
                      );
                    }}
                    style={{ flex: 1 }}
                  />

                  <Button
                    title="Omitir"
                    disabled={!late}
                    variant="ghost"
                    onPress={() => setStatus(d.key, 'skipped')}
                    style={{ flex: 1 }}
                  />
                </View>
              ) : (
                <Button title="Deshacer" variant="ghost" small onPress={() => clearStatus(d.key)} style={{ marginTop: 10 }} />
              )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  summary: { fontSize: font.body, fontWeight: '800', color: colors.primaryDark },
  emptyTitle: { fontSize: 19, fontWeight: '800', color: colors.text, marginBottom: 6 },
  emptyText: { fontSize: font.body, color: colors.muted, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  time: { fontSize: font.big, fontWeight: '800', color: colors.primaryDark },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  dose: { fontSize: font.body, color: colors.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
});
