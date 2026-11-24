// Recuperación de contraseña mediante código enviado al correo por el backend.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Header, Button, Field, Card } from '../src/components/UI';
import { colors, font } from '../src/theme';
import { requestPasswordReset, resetPassword, validateEmail, validatePassword } from '../src/services/auth';
import { notify } from '../src/utils/dialog';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    setError('');
    const problem = validateEmail(email);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await requestPasswordReset({ email });
      setCodeSent(true);
      notify('Solicitud enviada', 'Si el correo está registrado, recibirás un código de 6 dígitos. Revisa también la carpeta de correo no deseado.');
    } catch (e) {
      setError(e.message || 'No se pudo solicitar el código.');
    }
    setBusy(false);
  };

  const submit = async () => {
    setError('');
    const problem = !/^\d{6}$/.test(code.trim()) ? 'Escribe el código de 6 dígitos.' : validatePassword(pass) || (pass !== pass2 ? 'Las contraseñas no coinciden.' : null);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await resetPassword({ email, code, newPassword: pass });
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
          <Text style={s.info}>{codeSent
            ? 'Escribe el código de 6 dígitos que enviamos a tu correo y define una contraseña nueva. El código vence en 15 minutos.'
            : 'Escribe el correo asociado a tu cuenta. Te enviaremos un código de 6 dígitos para verificar que eres tú.'}</Text>
        </Card>
        <Field label="Correo electrónico" value={email} onChangeText={setEmail} placeholder="nombre@correo.com"
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!codeSent} />
        {!codeSent ? (
          <Button title={busy ? 'Enviando...' : 'Enviar código'} onPress={sendCode} disabled={busy} />
        ) : (
          <>
            <Field label="Código de verificación" value={code} onChangeText={setCode} placeholder="123456"
              keyboardType="number-pad" maxLength={6} autoCapitalize="none" />
            <Field label="Contraseña nueva" value={pass} onChangeText={setPass} placeholder="Mínimo 8 caracteres"
              secureTextEntry autoCapitalize="none" autoComplete="new-password" />
            <Field label="Repite la contraseña nueva" value={pass2} onChangeText={setPass2} placeholder="Escríbela otra vez"
              secureTextEntry autoCapitalize="none" autoComplete="new-password" onSubmitEditing={submit} />
            <Button title={busy ? 'Guardando...' : 'Cambiar contraseña'} onPress={submit} disabled={busy} />
            <Button title="Enviar otro código" onPress={sendCode} disabled={busy} variant="outline" />
          </>
        )}
        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  info: { fontSize: font.body, color: colors.primaryDark, lineHeight: 24 },
  error: { fontSize: 15, color: colors.danger, backgroundColor: '#FDECEA', borderRadius: 10, padding: 12, marginBottom: 14, lineHeight: 21 },
});
