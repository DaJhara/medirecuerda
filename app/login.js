// Ruta "/login": inicio de sesión y registro con correo y contraseña.
// (El acceso con Google se retiró de esta pantalla; el código de Google sigue en src/services/googleAuth.js por si se reactiva.)
// Es la única pantalla accesible sin sesión (ver app/_layout.js): al iniciar sesión, el layout
// lleva solo a las pestañas.
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field } from '../src/components/UI';
import { colors, font, radius } from '../src/theme';
import { useApp } from '../src/context/AppContext';
import { validateEmail, validatePassword } from '../src/services/auth';
import { wakeServer } from '../src/services/api';

// Contraseña: al registrarse se valida la longitud; al iniciar sesión solo que no esté vacía.
function checkPassword(isRegister, password) {
  if (isRegister) return validatePassword(password);
  return password ? null : 'Escribe tu contraseña.';
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, signUp } = useApp();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Despierta el servidor mientras el usuario escribe sus datos: así el inicio de sesión no espera el arranque.
  useEffect(() => { wakeServer(); }, []);
  const isRegister = mode === 'register';
  const idleTitle = isRegister ? 'Crear cuenta' : 'Iniciar sesión';
  const buttonTitle = busy ? 'Un momento...' : idleTitle;

  const switchMode = (m) => {
    setMode(m);
    setError('');
  };

  // Envía el formulario de correo y contraseña.
  const submit = async () => {
    setError('');
    if (isRegister && !name.trim()) return setError('Escribe tu nombre completo.');
    const problem = validateEmail(email) || checkPassword(isRegister, password);
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
        {/* Contraseña: el ojito va dentro del campo, a la derecha */}
        <View style={{ marginBottom: 14 }}>
          <Text style={s.label}>Contraseña</Text>
          <View style={s.passBox}>
            <TextInput
              style={s.passInput}
              value={password}
              onChangeText={setPassword}
              placeholder={isRegister ? 'Mínimo 8 caracteres' : 'Tu contraseña'}
              placeholderTextColor="#98A89B"
              secureTextEntry={!showPass}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              onSubmitEditing={submit}
            />
            <TouchableOpacity
              onPress={() => setShowPass((v) => !v)}
              style={s.eye}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={24} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Solo al iniciar sesión: abre el formulario para recuperar la contraseña */}
        {!isRegister && (
          <TouchableOpacity onPress={() => router.push('/forgot-password')} style={s.forgot} accessibilityRole="link" accessibilityLabel="Olvidé mi contraseña">
            <Text style={s.forgotText}>Olvidé mi contraseña</Text>
          </TouchableOpacity>
        )}

        {error ? (
          <View style={s.error} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <Button title={buttonTitle} onPress={submit} disabled={busy} />

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
  label: { fontSize: 15, fontWeight: '700', color: colors.primaryDark, marginBottom: 6 },
  passBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: colors.primaryMid, borderRadius: radius.md, backgroundColor: colors.white },
  passInput: { flex: 1, minHeight: 52, paddingHorizontal: 14, fontSize: font.body, color: colors.text },
  eye: { width: 48, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  forgot: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginBottom: 10 },
  forgotText: { fontSize: 16, fontWeight: '800', color: colors.primary, textDecorationLine: 'underline' },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FDECEA', borderRadius: radius.sm, padding: 12, marginBottom: 14 },
  errorText: { flex: 1, fontSize: 15, color: colors.danger, lineHeight: 21 },
  legal: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 24, lineHeight: 19 },
});
