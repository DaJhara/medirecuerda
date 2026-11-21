// Ruta "/scan": foto o texto -> IA (OpenRouter) identifica cada medicamento -> imagen de referencia
// (mercado colombiano) -> revisión -> guardar.
// La IA solo transcribe; el usuario SIEMPRE revisa y corrige antes de guardar.
import React, { useState } from 'react';
import { View, Text, ScrollView, Image, ActivityIndicator, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Header, Button, Card, Field } from '../src/components/UI';
import { colors, font } from '../src/theme';
import { analyzePrescription } from '../src/services/ai';
import { findReferenceImage } from '../src/services/imageSearch';
import { parseTime, nextOccurrence } from '../src/services/schedule';
import { useApp } from '../src/context/AppContext';

export default function ScanScreen() {
  const router = useRouter();
  const { saveMany } = useApp();
  const onClose = () => router.back();
  const onSaveMany = async (arr) => { await saveMany(arr); router.replace('/'); };
  const [image, setImage] = useState(null); // { uri, base64, mime }
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState(null); // resultados editables

  // Abre cámara o galería y guarda la imagen en base64 (calidad media para ahorrar datos).
  const pick = async (fromCamera) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permiso necesario', 'Concede el permiso para continuar.');
    const opts = { mediaTypes: ['images'], base64: true, quality: 0.5 };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setImage({ uri: a.uri, base64: a.base64, mime: a.mimeType || 'image/jpeg' });
    setItems(null);
  };

  const analyze = async () => {
    if (!image && !text.trim()) return Alert.alert('Falta información', 'Toma una foto o pega el texto de la orden.');
    setLoading(true);
    try {
      const meds = await analyzePrescription({ text: text.trim(), imageBase64: image?.base64, mime: image?.mime });
      if (meds.length === 0) {
        Alert.alert('Sin resultados', 'No encontré medicamentos. Prueba con una foto más nítida o pega el texto.');
        setItems(null);
      } else {
        const defaultTime = `${String((new Date().getHours() + 1) % 24).padStart(2, '0')}:00`;
        setItems(
          meds.map((m) => ({
            include: true,
            name: m.name,
            activeIngredient: m.activeIngredient, // identificado por la IA
            strength: m.strength,
            form: m.form,
            imageUrl: null,
            imageSource: null,
            dose: m.dose,
            intervalHours: String(m.intervalHours),
            durationDays: m.durationDays ? String(m.durationDays) : '',
            notes: m.notes,
            time: defaultTime,
          }))
        );
        // Imagen de referencia del mercado colombiano, una búsqueda por medicamento.
        meds.forEach(async (m, i) => {
          const img = await findReferenceImage(m);
          if (img) update(i, { imageUrl: img.url, imageSource: img.source });
        });
      }
    } catch (e) {
      Alert.alert('No se pudo analizar', e.message);
    } finally {
      setLoading(false);
    }
  };

  const update = (i, patch) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  // Valida y convierte los elementos seleccionados en medicamentos.
  const saveSelected = () => {
    const chosen = items.filter((it) => it.include);
    if (chosen.length === 0) return Alert.alert('Nada seleccionado', 'Marca al menos un medicamento.');
    const result = [];
    for (const it of chosen) {
      const t = parseTime(it.time);
      const interval = parseInt(it.intervalHours, 10);
      const days = it.durationDays.trim() === '' ? null : parseInt(it.durationDays, 10);
      if (!it.name.trim() || !t || !(interval >= 1 && interval <= 24) || (days !== null && !(days > 0))) {
        return Alert.alert('Revisa los datos', `Hay un dato no válido en "${it.name || 'medicamento'}". Corrígelo e intenta de nuevo.`);
      }
      result.push({
        name: it.name.trim(),
        dose: it.dose.trim() || 'Según orden médica',
        intervalHours: interval,
        startAt: nextOccurrence(t.h, t.m),
        durationDays: days,
        notes: it.notes.trim(),
        active: true,
        activeIngredient: it.activeIngredient || '',
        imageUrl: it.imageUrl || null,
        imageSource: it.imageSource || null,
      });
    }
    onSaveMany(result);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Escanear orden médica" subtitle="La IA propone, tú confirmas" onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card style={{ backgroundColor: colors.primaryLight, borderColor: colors.primaryMid }}>
          <Text style={s.note}>
            Fotografía tu orden médica o pega su texto. Revisa siempre los datos con tu fórmula original: la app no
            reemplaza la indicación de tu médico.
          </Text>
        </Card>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          <Button title="Tomar foto" onPress={() => pick(true)} style={{ flex: 1 }} />
          <Button title="Galería" variant="outline" onPress={() => pick(false)} style={{ flex: 1 }} />
        </View>

        {image && <Image source={{ uri: image.uri }} style={s.preview} resizeMode="contain" />}

        <Field
          label="O pega el texto de la orden"
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Ej. Acetaminofén 500 mg, 1 tableta cada 8 horas por 5 días"
        />

        <Button title={loading ? 'Analizando...' : 'Analizar con IA'} onPress={analyze} disabled={loading} />
        {loading && <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 16 }} />}

        {items && (
          <View style={{ marginTop: 20 }}>
            <Text style={s.section}>Revisa y corrige</Text>
            {items.map((it, i) => (
              <Card key={i} style={!it.include ? { opacity: 0.5 } : undefined}>
                <TouchableOpacity onPress={() => update(i, { include: !it.include })} style={s.check}>
                  <View style={[s.box, it.include && { backgroundColor: colors.primary }]}>
                    {it.include && <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text>}
                  </View>
                  <Text style={s.checkText}>{it.include ? 'Se agregará' : 'No se agregará'}</Text>
                </TouchableOpacity>
                {/* Identificación hecha por la IA + imagen de referencia */}
                {(it.activeIngredient || it.strength || it.form || it.imageUrl) && (
                  <View style={s.ident}>
                    {it.imageUrl ? <Image source={{ uri: it.imageUrl }} style={s.thumb} resizeMode="contain" /> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={s.identTitle}>Identificado por la IA</Text>
                      {it.activeIngredient ? <Text style={s.identText}>Principio activo: {it.activeIngredient}</Text> : null}
                      {it.strength || it.form ? <Text style={s.identText}>{[it.strength, it.form].filter(Boolean).join(' · ')}</Text> : null}
                      {it.imageUrl ? <Text style={s.identSrc}>Imagen de referencia · {it.imageSource}</Text> : null}
                    </View>
                  </View>
                )}
                <Field label="Medicamento" value={it.name} onChangeText={(v) => update(i, { name: v })} />
                <Field label="Dosis" value={it.dose} onChangeText={(v) => update(i, { dose: v })} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Field label="Cada (horas)" value={it.intervalHours} onChangeText={(v) => update(i, { intervalHours: v })} keyboardType="number-pad" style={{}} />
                  <Field label="Días" value={it.durationDays} onChangeText={(v) => update(i, { durationDays: v })} keyboardType="number-pad" placeholder="continuo" />
                </View>
                <Field label="Primera toma (HH:MM)" value={it.time} onChangeText={(v) => update(i, { time: v })} keyboardType="numbers-and-punctuation" />
                <Field label="Indicaciones" value={it.notes} onChangeText={(v) => update(i, { notes: v })} />
              </Card>
            ))}
            <Button title="Guardar medicamentos" onPress={saveSelected} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  note: { fontSize: 15, color: colors.primaryDark, lineHeight: 21 },
  preview: { width: '100%', height: 200, borderRadius: 14, backgroundColor: colors.primaryLight, marginBottom: 14 },
  section: { fontSize: font.title, fontWeight: '800', color: colors.primaryDark, marginBottom: 10 },
  check: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  ident: { flexDirection: 'row', gap: 12, backgroundColor: colors.primaryLight, borderRadius: 14, padding: 10, marginBottom: 14, alignItems: 'center' },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.white },
  identTitle: { fontSize: 13, fontWeight: '800', color: colors.primaryDark, marginBottom: 2 },
  identText: { fontSize: 15, color: colors.text },
  identSrc: { fontSize: 11, color: colors.muted, marginTop: 2 },
  checkText: { fontSize: 15, fontWeight: '700', color: colors.primaryDark },
});
