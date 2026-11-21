// Ruta "/meds" (pestaña Medicamentos): lista de tratamientos.
// Cada tarjeta tiene iconos para editar y eliminar (la eliminación pide confirmación).
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header, Card, Button, Badge } from '../../src/components/UI';
import { colors, font } from '../../src/theme';
import { endDate, fmtDate } from '../../src/services/schedule';
import { fmtInterval } from '../../src/utils/time';
import { useApp } from '../../src/context/AppContext';

export default function MedsScreen() {
  const router = useRouter();
  const { meds, toggleActive, deleteMed } = useApp();
  const onAdd = () => router.push('/med-form');
  const onEdit = (m) => router.push({ pathname: '/med-form', params: { id: m.id } });
  const onScan = () => router.push('/scan');

  // La confirmación se mantiene ANTES de eliminar.
  const confirmDelete = (m) =>
    Alert.alert(
      'Eliminar medicamento',
      `¿Eliminar "${m.name}" y sus recordatorios? El historial de tomas se conserva.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => deleteMed(m.id) },
      ]
    );

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
                {/* Iconos de acción: editar y eliminar */}
                <TouchableOpacity onPress={() => onEdit(m)} style={s.icon} accessibilityRole="button" accessibilityLabel={`Editar ${m.name}`}>
                  <Ionicons name="create-outline" size={26} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete(m)} style={s.icon} accessibilityRole="button" accessibilityLabel={`Eliminar ${m.name}`}>
                  <Ionicons name="trash-outline" size={26} color={colors.danger} />
                </TouchableOpacity>
              </View>
              <Text style={s.dose}>{m.dose || 'Dosis sin especificar'}</Text>
              <View style={s.badges}>
                <Badge text={fmtInterval(m.intervalHours)} />
                <Badge text={end ? `Hasta ${fmtDate(end)}` : 'Tratamiento continuo'} />
                {!m.active && <Badge text="Suspendido" color={colors.muted} bg="#EEEEEE" />}
              </View>
              {m.notes ? <Text style={s.notes}>{m.notes}</Text> : null}
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>Recordatorios activos</Text>
                <Switch
                  value={m.active}
                  onValueChange={() => toggleActive(m.id)}
                  trackColor={{ true: colors.primaryMid, false: '#CCCCCC' }}
                  thumbColor={m.active ? colors.primary : '#F4F4F4'}
                />
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 20, fontWeight: '800', color: colors.text, flex: 1, paddingRight: 8 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dose: { fontSize: font.body, color: colors.muted, marginTop: 2, marginBottom: 8 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  notes: { fontSize: 15, color: colors.primaryDark, marginTop: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  switchLabel: { fontSize: 15, color: colors.muted, fontWeight: '600' },
  empty: { fontSize: font.body, color: colors.muted, textAlign: 'center', marginVertical: 24 },
});
