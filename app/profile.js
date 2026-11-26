// Ruta "/profile": datos personales del usuario (se guardan en la tabla app_users de SQLite).
// Campos: foto, nombre completo (con apellidos), edad, altura, peso y observaciones.
// Con Google, nombre y foto se toman de la cuenta la primera vez, pero aquí se pueden modificar.
import React, { useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../src/components/AppText';
import { useRouter } from 'expo-router';
import { Header, Button, Field, Avatar } from '../src/components/UI';
import { colors } from '../src/theme';
import { useApp } from '../src/context/AppContext';
import { pickProfilePhoto } from '../src/utils/photo';
import { notify } from '../src/utils/dialog';

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
  const [photo, setPhoto] = useState(profile.photoUrl); // foto mostrada (se guarda al pulsar Guardar)
  const [saving, setSaving] = useState(false);

  const changePhoto = async () => {
    try {
      const picked = await pickProfilePhoto();
      if (picked) setPhoto(picked);
    } catch (e) {
      notify('No se pudo cambiar la foto', e.message);
    }
  };

  const submit = async () => {
    if (!fullName.trim()) return notify('Falta el nombre', 'Escribe tu nombre completo, con apellidos.');

    const a = toNumber(age);
    const h = toNumber(height);
    const w = toNumber(weight);
    if (a !== null && (!Number.isInteger(a) || a < 0 || a > 120)) return notify('Edad no válida', 'Escribe una edad entre 0 y 120 años.');
    if (h !== null && (!(h >= 30 && h <= 260))) return notify('Altura no válida', 'Escribe la altura en centímetros (por ejemplo 165).');
    if (w !== null && (!(w >= 1 && w <= 500))) return notify('Peso no válido', 'Escribe el peso en kilogramos (por ejemplo 68,5).');

    setSaving(true);
    try {
      await saveProfile({ fullName, age: a, heightCm: h, weightKg: w, observations: notes, photoUrl: photo });
      notify('Perfil guardado', 'Tus datos se guardaron correctamente.');
      router.back();
    } catch (e) {
      notify('No se pudo guardar', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Perfil" subtitle="Tus datos personales" onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {/* Foto de perfil (modificable) */}
          <View style={s.photoBox}>
            <Avatar uri={photo} name={fullName} size={104} bg={colors.primaryLight} />
            <View style={s.photoBtns}>
              <TouchableOpacity onPress={changePhoto} style={s.photoBtn} accessibilityRole="button">
                <Text style={s.photoBtnText}>{photo ? 'Cambiar foto' : 'Agregar foto'}</Text>
              </TouchableOpacity>
              {photo ? (
                <TouchableOpacity onPress={() => setPhoto(null)} style={s.photoBtn} accessibilityRole="button">
                  <Text style={[s.photoBtnText, { color: colors.danger }]}>Quitar foto</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {profile.email ? (
              <Text style={s.email}>
                {profile.provider === 'google' ? 'Cuenta de Google · ' : ''}{profile.email}
              </Text>
            ) : null}
          </View>

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
          {/* Botones lado a lado: más compactos y fáciles de distinguir */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Button title="Cancelar" variant="outline" onPress={() => router.back()} style={{ flex: 1 }} />
            <Button title={saving ? 'Guardando...' : 'Guardar'} onPress={submit} disabled={saving} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  photoBox: { alignItems: 'center', marginBottom: 20 },
  photoBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  photoBtn: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  photoBtnText: { fontSize: 16, fontWeight: '800', color: colors.primary },
  email: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
