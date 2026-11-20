// Ruta "/meds" (pestaña Medicamentos): lista de tratamientos con acceso a editar y escanear.
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { Header, Card, Button, Badge } from '../../src/components/UI';
import { colors, font } from '../../src/theme';
import { endDate, fmtDate } from '../../src/services/schedule';
import { useApp } from '../../src/context/AppContext';

export default function MedsScreen() {
  const router = useRouter();
  const { meds, toggleActive } = useApp();
  const onAdd = () => router.push('/med-form');
  const onEdit = (m) => router.push({ pathname: '/med-form', params: { id: m.id } });
  const onScan = () => router.push('/scan');
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Mis medicamentos" subtitle={`${meds.length} registrado(s)`} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        <View style={{ gap: 10, marginBottom: 16 }}>
          <Button title="Escanear orden médica con IA" onPress={onScan} />
          <Button title="Agregar manualmente" variant="outline" onPress={onAdd} />
        </View>

        {meds.length === 0 && (
          <Text style={s.empty}>Aún no tienes medicamentos. Escanea tu orden médica o agrégalos a mano.</Text>
        )}

        {meds.map((m) => {
          const end = endDate(m);
          return (
            <Card key={m.id} style={!m.active ? { opacity: 0.6 } : undefined}>
              <View style={s.row}>
                <Text style={s.name}>{m.name}</Text>
                <Switch
                  value={m.active}
                  onValueChange={() => toggleActive(m.id)}
                  trackColor={{ true: colors.primaryMid, false: '#CCCCCC' }}
                  thumbColor={m.active ? colors.primary : '#F4F4F4'}
                />
              </View>
              <Text style={s.dose}>{m.dose || 'Dosis sin especificar'}</Text>
              <View style={s.badges}>
                <Badge text={`Cada ${m.intervalHours} h`} />
                <Badge text={end ? `Hasta ${fmtDate(end)}` : 'Tratamiento continuo'} />
                {!m.active && <Badge text="Suspendido" color={colors.muted} bg="#EEEEEE" />}
              </View>
              {m.notes ? <Text style={s.notes}>{m.notes}</Text> : null}
              <Button title="Editar" variant="ghost" small onPress={() => onEdit(m)} style={{ marginTop: 12 }} />
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 20, fontWeight: '800', color: colors.text, flex: 1, paddingRight: 8 },
  dose: { fontSize: font.body, color: colors.muted, marginTop: 2, marginBottom: 8 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  notes: { fontSize: 15, color: colors.primaryDark, marginTop: 8 },
  empty: { fontSize: font.body, color: colors.muted, textAlign: 'center', marginVertical: 24 },
});
