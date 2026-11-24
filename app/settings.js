// Ruta "/settings": configuración de los recordatorios.
//  - Sonido: activa/desactiva y permite elegir un tono del celular.
//  - Vibración: activa/desactiva.
// Cada cambio se guarda y reprograma las notificaciones pendientes.
import React from 'react';
import { View, Text, ScrollView, Switch, StyleSheet, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Header, Card, Button } from '../src/components/UI';
import { colors } from '../src/theme';
import { useApp } from '../src/context/AppContext';
import { openToneSettings, sendTestNotification } from '../src/services/notifications';

const trackColor = { true: colors.primaryMid, false: '#CCCCCC' };

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, updateSettings } = useApp();
  const isAndroid = Platform.OS === 'android';

  const onPickTone = async () => {
    const opened = await openToneSettings(settings);
    if (!opened) Alert.alert('No disponible', 'En iPhone el tono de las notificaciones no se puede elegir desde la app.');
  };

  const onTest = async () => {
    await sendTestNotification(settings);
    Alert.alert('Prueba programada', 'En 5 segundos recibirás una notificación de prueba. Puedes bloquear la pantalla para verla.');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Configuraciones" subtitle="Sonido y vibración" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {/* Sonido */}
        <Card>
          <View style={s.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={s.title}>Sonido</Text>
              <Text style={s.desc}>La app suena cuando es hora de tomar un medicamento.</Text>
            </View>
            <Switch
              value={settings.sound}
              onValueChange={(v) => updateSettings({ sound: v })}
              trackColor={trackColor}
              thumbColor={settings.sound ? colors.primary : '#F4F4F4'}
              accessibilityLabel="Activar sonido"
            />
          </View>

          <View style={s.divider} />
          <Text style={s.title}>Tono</Text>
          <Text style={s.desc}>
            {isAndroid
              ? 'Elige uno de los tonos de tu celular. Se abrirá la configuración del sistema: toca "Sonido" y selecciona el tono.'
              : 'En iPhone el tono de las notificaciones no se puede cambiar desde la app.'}
          </Text>
          <Button
            title="Elegir tono del celular"
            variant="outline"
            disabled={!settings.sound || !isAndroid}
            onPress={onPickTone}
            style={{ marginTop: 10 }}
          />
          {!settings.sound && isAndroid && <Text style={s.note}>Activa el sonido para elegir un tono.</Text>}
        </Card>

        {/* Vibración */}
        <Card>
          <View style={s.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={s.title}>Vibración</Text>
              <Text style={s.desc}>
                {isAndroid
                  ? 'El teléfono vibra con cada recordatorio.'
                  : 'En iPhone la vibración depende de los ajustes de sonido del sistema.'}
              </Text>
            </View>
            <Switch
              value={settings.vibrate}
              onValueChange={(v) => updateSettings({ vibrate: v })}
              trackColor={trackColor}
              thumbColor={settings.vibrate ? colors.primary : '#F4F4F4'}
              accessibilityLabel="Activar vibración"
            />
          </View>
        </Card>

        <Button title="Enviar notificación de prueba" onPress={onTest} />
        <Text style={s.note}>
          Si apagas sonido y vibración, recibirás los avisos solo en pantalla, sin sonido ni vibración.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 19, fontWeight: '800', color: colors.text },
  desc: { fontSize: 15, color: colors.muted, marginTop: 4, lineHeight: 21 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
  note: { fontSize: 13, color: colors.muted, marginTop: 10, lineHeight: 18 },
});
