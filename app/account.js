// Ruta "/account": información de la cuenta (por ahora, cuenta local del teléfono).
// Espacio reservado para inicio de sesión y sincronización con el servidor (Postgres).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Header, Card, Badge } from '../src/components/UI';
import { colors, font } from '../src/theme';
import { getAccountInfo } from '../src/db/repository';
import { fmtDate } from '../src/services/schedule';
import { useApp } from '../src/context/AppContext';

export default function AccountScreen() {
  const router = useRouter();
  const { profile } = useApp();
  const [info, setInfo] = useState(null);

  useEffect(() => {
    getAccountInfo().then(setInfo).catch(() => {});
  }, []);

  const rows = info
    ? [
        ['Titular', profile.fullName || 'Sin nombre (completa tu perfil)'],
        ['Tipo de cuenta', 'Local (solo en este teléfono)'],
        ['Cuenta creada', fmtDate(info.createdAt)],
        ['Medicamentos activos', String(info.meds)],
        ['Registros de tomas', String(info.records)],
        ['Pendientes de sincronizar', String(info.unsynced)],
        ['Identificador', info.id.slice(0, 8) + '…'],
      ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Cuenta" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        <Card>
          {rows.map(([k, v]) => (
            <View key={k} style={s.row}>
              <Text style={s.key}>{k}</Text>
              <Text style={s.value}>{v}</Text>
            </View>
          ))}
        </Card>
        <Card style={{ backgroundColor: colors.primaryLight, borderColor: colors.primaryMid }}>
          <Badge text="Próximamente" />
          <Text style={s.soon}>
            Aquí podrás iniciar sesión y sincronizar tus datos con el servidor para no perderlos al cambiar de teléfono.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  key: { fontSize: 14, color: colors.muted, fontWeight: '700' },
  value: { fontSize: font.body, color: colors.text, marginTop: 2 },
  soon: { fontSize: 15, color: colors.primaryDark, marginTop: 10, lineHeight: 21 },
});
