// Ruta "/profile": datos personales del usuario (se guardan en la tabla app_users de SQLite).
// Campos: nombre completo (con apellidos), edad, altura, peso y observaciones.
import React, { useState } from 'react';
import { View, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Header, Button, Field } from '../src/components/UI';
import { colors } from '../src/theme';
import { useApp } from '../src/context/AppContext';

// Convierte "1,65" o "1.65" en número; vacío -> null; texto inválido -> NaN.
const toNumber = (v) => {
  const t = String(v ?? '').trim().replace(',', '.');
  return t === '' ? null : Number(t);
};

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, saveProfile } = useApp();

  // Los números se editan como texto para permitir decimales mientras se escribe.
  const [fullName, setFullName] = useState(profile.fullName);
  const [age, setAge] = useState(profile.age != null ? String(profile.age) : '');
  const [height, setHeight] = useState(profile.heightCm != null ? String(profile.heightCm) : '');
  const [weight, setWeight] = useState(profile.weightKg != null ? String(profile.weightKg) : '');
  const [notes, setNotes] = useState(profile.observations);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!fullName.trim()) return Alert.alert('Falta el nombre', 'Escribe tu nombre completo, con apellidos.');

    const a = toNumber(age);
    const h = toNumber(height);
    const w = toNumber(weight);
    if (a !== null && (!Number.isInteger(a) || a < 0 || a > 120)) return Alert.alert('Edad no válida', 'Escribe una edad entre 0 y 120 años.');
    if (h !== null && (!(h >= 30 && h <= 260))) return Alert.alert('Altura no válida', 'Escribe la altura en centímetros (por ejemplo 165).');
    if (w !== null && (!(w >= 1 && w <= 500))) return Alert.alert('Peso no válido', 'Escribe el peso en kilogramos (por ejemplo 68,5).');

    setSaving(true);
    try {
      await saveProfile({ fullName, age: a, heightCm: h, weightKg: w, observations: notes });
      Alert.alert('Perfil guardado', 'Tus datos se guardaron correctamente.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('No se pudo guardar', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Perfil" subtitle="Tus datos personales" onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Field label="Nombre completo (con apellidos)" value={fullName} onChangeText={setFullName} placeholder="Ej. María Fernanda López Gómez" autoCapitalize="words" />
          <Field label="Edad (años)" value={age} onChangeText={setAge} placeholder="Ej. 72" keyboardType="number-pad" maxLength={3} />
          <Field label="Altura (cm)" value={height} onChangeText={setHeight} placeholder="Ej. 165" keyboardType="decimal-pad" maxLength={5} />
          <Field label="Peso (kg)" value={weight} onChangeText={setWeight} placeholder="Ej. 68,5" keyboardType="decimal-pad" maxLength={5} />
          <Field
            label="Observaciones"
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Alergias, condiciones médicas, notas para tu médico..."
            hint="Solo se guarda en tu teléfono."
          />
          <Button title={saving ? 'Guardando...' : 'Guardar'} onPress={submit} disabled={saving} />
          <Button title="Cancelar" variant="outline" onPress={() => router.back()} style={{ marginTop: 10 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
