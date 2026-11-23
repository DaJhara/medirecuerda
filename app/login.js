// Ruta "/login": inicio de sesión y registro (correo + contraseña, o cuenta de Google).
// Es la única pantalla accesible sin sesión (ver app/_layout.js): al iniciar sesión, el layout
// lleva solo a las pestañas.
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field } from '../src/components/UI';
import { colors, font, radius } from '../src/theme';
import { useApp } from '../src/context/AppContext';
import { validateEmail, validatePassword } from '../src/services/auth';

// Traduce los errores de Google a mensajes comprensibles.
function googleMessage(e) {
  switch (e.code) {
    case 'NOT_CONFIGURED': return 'El acceso con Google aún no está configurado. Falta EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (ver docs/LOGIN_GOOGLE.md).';
    case 'NO_MODULE': return 'Esta compilación de la app no incluye Google. Instala el módulo y vuelve a generar el development build (ver docs/LOGIN_GOOGLE.md).';
    default: return e.message || 'No se pudo iniciar sesión con Google.';
  }
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn, signUp, signInGoogle } = useApp();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  const switchMode = (m) => {
    setMode(m);
    setError('');
  };

  // Envía el formulario de correo y contraseña.
  const submit = async () => {
    setError('');
    if (isRegister && !name.trim()) return setError('Escribe tu nombre completo.');
    const problem = validateEmail(email) || (isRegister ? validatePassword(password) : password ? null : 'Escribe tu contraseña.');
    if (problem) return setError(problem);
    setBusy(true);
    try {
      if (isRegister) await signUp({ name, email, password });
      else await signIn({ email, password });
      // Si todo sale bien, el layout cambia solo a las pestañas.
    } catch (e) {
      setError(e.message || 'No se pudo completar la operación.');
      setBusy(false);
    }
  };

  const google = async () => {
    setError('');
    setBusy(true);
    try {
      await signInGoogle(); // false = canceló: no es un error
    } catch (e) {
      setError(googleMessage(e));
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {/* Marca */}
        <View style={s.brand}>
          <View style={s.logo}>
            <Ionicons name="medkit" size={40} color={colors.white} />
          </View>
          <Text style={s.title}>MediRecuerda</Text>
          <Text style={s.subtitle}>Tus medicamentos, a tiempo</Text>
        </View>

        {/* Pestañas: iniciar sesión / crear cuenta */}
        <View style={s.tabs}>
          {[['login', 'Iniciar sesión'], ['register', 'Crear cuenta']].map(([k, label]) => (
            <TouchableOpacity key={k} style={[s.tab, mode === k && s.tabOn]} onPress={() => switchMode(k)} accessibilityRole="tab" accessibilityState={{ selected: mode === k }}>
              <Text style={[s.tabText, mode === k && { color: colors.white }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {isRegister && (
          <Field label="Nombre completo" value={name} onChangeText={setName} placeholder="Ej. María Fernanda López" autoCapitalize="words" autoComplete="name" />
        )}
        <Field
          label="Correo electrónico"
          value={email}
          onChangeText={setEmail}
          placeholder="nombre@correo.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
        />
        <Field
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          placeholder={isRegister ? 'Mínimo 8 caracteres' : 'Tu contraseña'}
          secureTextEntry={!showPass}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          onSubmitEditing={submit}
        />
        <TouchableOpacity onPress={() => setShowPass((v) => !v)} style={s.showPass} accessibilityRole="button">
          <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.primary} />
          <Text style={s.showPassText}>{showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}</Text>
        </TouchableOpacity>

        {error ? (
          <View style={s.error} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <Button title={busy ? 'Un momento...' : isRegister ? 'Crear cuenta' : 'Iniciar sesión'} onPress={submit} disabled={busy} />

        {/* Separador */}
        <View style={s.or}>
          <View style={s.line} />
          <Text style={s.orText}>o</Text>
          <View style={s.line} />
        </View>

        <TouchableOpacity style={[s.google, busy && { opacity: 0.5 }]} onPress={google} disabled={busy} accessibilityRole="button" accessibilityLabel="Continuar con Google">
          <Ionicons name="logo-google" size={22} color="#DB4437" />
          <Text style={s.googleText}>Continuar con Google</Text>
        </TouchableOpacity>

        {busy && <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />}

        <Text style={s.legal}>
          Tus datos de salud se guardan en este teléfono. Al continuar aceptas que MediRecuerda es una ayuda de recordatorio y no reemplaza la indicación de tu médico.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20 },
  brand: { alignItems: 'center', marginBottom: 24 },
  logo: { width: 76, height: 76, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 30, fontWeight: '800', color: colors.primaryDark },
  subtitle: { fontSize: font.body, color: colors.muted, marginTop: 2 },
  tabs: { flexDirection: 'row', backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: 4, marginBottom: 20 },
  tab: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tabOn: { backgroundColor: colors.primary },
  tabText: { fontSize: 16, fontWeight: '800', color: colors.primaryDark },
  showPass: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: -6, marginBottom: 6 },
  showPassText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FDECEA', borderRadius: radius.sm, padding: 12, marginBottom: 14 },
  errorText: { flex: 1, fontSize: 15, color: colors.danger, lineHeight: 21 },
  or: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { fontSize: 15, color: colors.muted, fontWeight: '700' },
  google: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 52, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.white },
  googleText: { fontSize: font.body, fontWeight: '700', color: colors.text },
  legal: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 24, lineHeight: 19 },
});
