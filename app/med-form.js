// Ruta "/med-form": crear o editar un medicamento (parámetro opcional ?id=...).
// Sirve para registrar cambios de dosis, frecuencia, horario o duración.
import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Header, Button, Chip, Field } from '../src/components/UI';
import { colors } from '../src/theme';
import { parseTime, atDayOffset } from '../src/services/schedule';
import { useApp } from '../src/context/AppContext';

const INTERVALS = [4, 6, 8, 12, 24];

export default function MedFormScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { meds, saveMed, deleteMed } = useApp();
  const med = id ? meds.find((m) => m.id === id) : undefined;
  const onClose = () => router.back();
  const onSave = (data) => { saveMed(data); router.back(); };
  const onDelete = (medId) => { deleteMed(medId); router.back(); };
  const editing = !!med;
  const [name, setName] = useState(med?.name || '');
  const [dose, setDose] = useState(med?.dose || '');
  const [interval, setIntervalH] = useState(med?.intervalHours || 8);
  const [time, setTime] = useState(
    med ? fmtTime24(med.startAt) : '08:00'
  );
  const [dayOffset, setDayOffset] = useState(0); // 0 = hoy, 1 = mañana
  const [days, setDays] = useState(med?.durationDays ? String(med.durationDays) : '');
  const [notes, setNotes] = useState(med?.notes || '');
  // Si el usuario no toca horario/frecuencia al editar, se conserva el calendario original.
  const [scheduleTouched, setScheduleTouched] = useState(!editing);

  const touch = (fn) => (v) => {
    setScheduleTouched(true);
    fn(v);
  };

  const submit = () => {
    if (!name.trim()) return Alert.alert('Falta el nombre', 'Escribe el nombre del medicamento.');
    if (!dose.trim()) return Alert.alert('Falta la dosis', 'Indica la dosis por toma (ej. 1 tableta).');
    const t = parseTime(time);
    if (!t) return Alert.alert('Hora no válida', 'Usa el formato HH:MM, por ejemplo 08:30 o 21:00.');
    const d = days.trim() === '' ? null : parseInt(days, 10);
    if (d !== null && (!(d > 0) || d > 365)) return Alert.alert('Duración no válida', 'Indica un número de días entre 1 y 365, o déjalo vacío.');

    onSave({
      id: med?.id,
      name: name.trim(),
      dose: dose.trim(),
      intervalHours: interval,
      startAt: scheduleTouched ? atDayOffset(t.h, t.m, dayOffset) : med.startAt,
      durationDays: d,
      notes: notes.trim(),
      active: med ? med.active : true,
    });
  };

  const confirmDelete = () =>
    Alert.alert('Eliminar medicamento', `¿Eliminar "${med.name}" y sus recordatorios?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => onDelete(med.id) },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={editing ? 'Editar medicamento' : 'Nuevo medicamento'} onBack={onClose} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Field label="Medicamento" value={name} onChangeText={setName} placeholder="Ej. Losartán 50 mg" />
          <Field label="Dosis por toma" value={dose} onChangeText={setDose} placeholder="Ej. 1 tableta" />

          <Text style={labelStyle}>Frecuencia: cada cuántas horas</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
            {INTERVALS.map((h) => (
              <Chip key={h} label={`${h} h`} selected={interval === h} onPress={() => touch(setIntervalH)(h)} />
            ))}
          </View>

          <Field
            label="Hora de la primera toma"
            value={time}
            onChangeText={touch(setTime)}
            placeholder="08:00"
            keyboardType="numbers-and-punctuation"
            hint="Formato 24 horas. Ej. 08:00, 14:30, 21:00."
          />

          <Text style={labelStyle}>{editing ? 'El nuevo horario empieza' : 'Empezar'}</Text>
          <View style={{ flexDirection: 'row', marginBottom: 10 }}>
            <Chip label="Hoy" selected={dayOffset === 0} onPress={() => touch(setDayOffset)(0)} />
            <Chip label="Mañana" selected={dayOffset === 1} onPress={() => touch(setDayOffset)(1)} />
          </View>

          <Field
            label="Duración del tratamiento (días)"
            value={days}
            onChangeText={setDays}
            placeholder="Vacío = continuo"
            keyboardType="number-pad"
            hint="Cuenta desde la primera toma. Déjalo vacío si el médico no indicó fin."
          />
          <Field label="Indicaciones (opcional)" value={notes} onChangeText={setNotes} placeholder="Ej. Con comida" multiline />

          <Button title="Guardar" onPress={submit} style={{ marginTop: 6 }} />
          <Button title="Cancelar" variant="outline" onPress={onClose} style={{ marginTop: 10 }} />
          {editing && <Button title="Eliminar medicamento" variant="danger" onPress={confirmDelete} style={{ marginTop: 10 }} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const labelStyle = { fontSize: 15, fontWeight: '700', color: colors.primaryDark, marginBottom: 8 };

// "HH:MM" en formato 24 h a partir de una fecha ISO.
function fmtTime24(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
