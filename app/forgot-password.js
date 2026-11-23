// Ruta "/forgot-password": formulario "Olvidé mi contraseña" (accesible sin sesión).
// Modo local: correo de la cuenta + contraseña nueva (2 veces). Al terminar vuelve al login.
// Con el backend desplegado, este formulario pasaría a pedir un código enviado al correo.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Header, Button, Field, Card } from '../src/components/UI';
import { colors, font } from '../src/theme';
import { resetPassword, validateEmail, validatePassword } from '../src/services/auth';
import { notify } from '../src/utils/dialog';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    const problem = validateEmail(email) || validatePassword(pass) || (pass !== pass2 ? 'Las contraseñas no coinciden.' : null);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await resetPassword({ email, newPassword: pass });
      notify('Contraseña actualizada', 'Ya puedes iniciar sesión con tu contraseña nueva.');
      router.back();
    } catch (e) {
      setError(e.message || 'No se pudo cambiar la contraseña.');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header title="Olvidé mi contraseña" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card style={{ backgroundColor: colors.primaryLight, borderColor: colors.primaryMid }}>
          <Text style={s.info}>Escribe el correo con el que creaste tu cuenta en este teléfono y elige una contraseña nueva.</Text>
        </Card>
        <Field label="Correo electrónico" value={email} onChangeText={setEmail} placeholder="nombre@correo.com"
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
        <Field label="Contraseña nueva" value={pass} onChangeText={setPass} placeholder="Mínimo 8 caracteres"
          secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label="Repite la contraseña nueva" value={pass2} onChangeText={setPass2} placeholder="Escríbela otra vez"
          secureTextEntry autoCapitalize="none" autoComplete="new-password" onSubmitEditing={submit} />
        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        <Button title={busy ? 'Guardando...' : 'Cambiar contraseña'} onPress={submit} disabled={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  info: { fontSize: font.body, color: colors.primaryDark, lineHeight: 24 },
  error: { fontSize: 15, color: colors.danger, backgroundColor: '#FDECEA', borderRadius: 10, padding: 12, marginBottom: 14, lineHeight: 21 },
});
