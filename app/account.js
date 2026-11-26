// Ruta "/account": información de la cuenta con la sesión iniciada y opción para eliminarla.
import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from '../src/components/AppText';
import { useRouter } from 'expo-router';
import { Header, Card, Button } from '../src/components/UI';
import { colors, font } from '../src/theme';
import { getAccountInfo } from '../src/db/repository';
import { refreshAccountCreatedAt } from '../src/services/auth';
import { fmtDate } from '../src/services/schedule';
import { useApp } from '../src/context/AppContext';
import { confirmAction, notify } from '../src/utils/dialog';

export default function AccountScreen() {
  const router = useRouter();
  const { profile, deleteAccount } = useApp();
  const [info, setInfo] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setInfo(await getAccountInfo());
        // La fecha de creación sale del servidor; si cambió respecto a la guardada, se vuelve a leer.
        if (await refreshAccountCreatedAt()) setInfo(await getAccountInfo());
      } catch {
        /* sin conexión o sin datos: la pantalla conserva lo que ya mostró */
      }
    };
    void load();
  }, []);

  const onDelete = async () => {
    const mail = info?.email || 'tu correo registrado';
    const message = info?.linked
      ? `Tu historial se enviará a ${mail} y después tu cuenta y todos tus datos se borrarán de nuestra base de datos y de este teléfono. Esta acción no se puede deshacer.`
      : 'Tu cuenta y todos tus datos se borrarán de este teléfono. Esta acción no se puede deshacer.';
    if (!(await confirmAction('¿Eliminar tu cuenta?', message, 'Eliminar cuenta', true))) return;
    setDeleting(true);
    try {
      await deleteAccount(); // al terminar, la app vuelve sola a la pantalla de inicio de sesión
    } catch (e) {
      setDeleting(false);
      notify('No se pudo eliminar la cuenta', e.message);
    }
  };

  // El identificador interno no se muestra.
  const rows = info
    ? [
        ['Titular', profile.fullName || 'Sin nombre (completa tu perfil)'],
        ['Correo', info.email || '—'],
        ['Tipo de cuenta', info.provider === 'google' ? 'Google' : 'Correo y contraseña'],
        ['Datos guardados en', info.linked ? 'Servidor (con copia en este teléfono)' : 'Este teléfono'],
        ['Cuenta creada', fmtDate(info.createdAt)],
        ['Medicamentos activos', String(info.meds)],
        ['Registros de tomas', String(info.records)],
        ['Pendientes de sincronizar', String(info.unsynced)],
      ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Cuenta" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Card>
          {rows.map(([k, v]) => (
            <View key={k} style={s.row}>
              <Text style={s.key}>{k}</Text>
              <Text style={s.value}>{v}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <Text style={s.dangerTitle}>Eliminar cuenta</Text>
          <Text style={s.dangerText}>
            {info?.linked
              ? 'Te enviamos tu historial por correo y borramos tus datos de nuestra base de datos.'
              : 'Se borrarán tu cuenta y tus datos de este teléfono.'}
          </Text>
          <Button title={deleting ? 'Eliminando...' : 'Eliminar cuenta'} variant="danger" onPress={onDelete} disabled={deleting || !info} />
        </Card>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  key: { fontSize: 14, color: colors.muted, fontWeight: '700' },
  value: { fontSize: font.body, color: colors.text, marginTop: 2 },
  dangerTitle: { fontSize: font.body, fontWeight: '800', color: colors.danger },
  dangerText: { fontSize: 15, color: colors.muted, marginVertical: 8, lineHeight: 21 },
});
