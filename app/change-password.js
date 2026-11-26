// Ruta "/change-password": cambiar la contraseña con la sesión iniciada (se abre desde el menú lateral).
// Pide la contraseña actual y la nueva (2 veces). Las cuentas de Google no tienen contraseña aquí.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '../src/components/AppText';
import { useRouter } from 'expo-router';
import { Header, Button, Field, Card } from '../src/components/UI';
import { colors, font } from '../src/theme';
import { changePassword, validatePassword } from '../src/services/auth';
import { useApp } from '../src/context/AppContext';
import { notify } from '../src/utils/dialog';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { profile } = useApp();
  const [current, setCurrent] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isGoogle = profile.provider === 'google';

  // Devuelve el primer problema del formulario, o null si todo está bien.
  const validateForm = () => {
    if (!current) return 'Escribe tu contraseña actual.';
    const weak = validatePassword(pass);
    if (weak) return weak;
    return pass === pass2 ? null : 'Las contraseñas nuevas no coinciden.';
  };

  const submit = async () => {
    setError('');
    const problem = validateForm();
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await changePassword({ current, newPassword: pass });
      notify('Contraseña actualizada', 'Tu contraseña se cambió correctamente.');
      router.back();
    } catch (e) {
      setError(e.message || 'No se pudo cambiar la contraseña.');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header title="Cambiar contraseña" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {isGoogle ? (
          <Card style={{ backgroundColor: colors.primaryLight, borderColor: colors.primaryMid }}>
            <Text style={s.info}>Tu cuenta usa Google, por eso no tiene contraseña en MediRecuerda. Para cambiarla, hazlo desde tu cuenta de Google.</Text>
          </Card>
        ) : (
          <>
            <Field label="Contraseña actual" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
            <Field label="Contraseña nueva" value={pass} onChangeText={setPass} placeholder="Mínimo 8 caracteres" secureTextEntry autoCapitalize="none" autoComplete="new-password" />
            <Field label="Repite la contraseña nueva" value={pass2} onChangeText={setPass2} secureTextEntry autoCapitalize="none" autoComplete="new-password" onSubmitEditing={submit} />
            {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button title={busy ? 'Guardando...' : 'Cambiar contraseña'} onPress={submit} disabled={busy} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  info: { fontSize: font.body, color: colors.primaryDark, lineHeight: 24 },
  error: { fontSize: 15, color: colors.danger, backgroundColor: '#FDECEA', borderRadius: 10, padding: 12, marginBottom: 14, lineHeight: 21 },
});
