// Ruta "/med-form": crear o editar un medicamento (parámetro opcional ?id=...).
// Sirve para registrar cambios de dosis, frecuencia, horario o duración.
import React, { useState } from 'react';
import { View, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '../src/components/AppText';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Header, Button, Chip, Field } from '../src/components/UI';
import { colors } from '../src/theme';
import { parseTime, atDayOffset } from '../src/services/schedule';
import { stockPlan } from '../src/services/refill';
import { useApp } from '../src/context/AppContext';

const INTERVALS = [4, 6, 8, 12, 24];
// Presentación del medicamento (opcional). "Otra" permite escribirla.
const PRESENTATIONS = ['Tabletas', 'Cápsulas', 'Gotas', 'Jarabe', 'Inyección', 'Crema o pomada', 'Inhalador', 'Sobres'];
const OTHER = 'Otra';

// Texto de ayuda del stock: cuánto alcanza y si faltan unidades para todo el tratamiento.
function stockHint(plan) {
  if (!plan) return null;
  const days = Math.floor(plan.daysCovered);
  const base = `Con esas unidades alcanzas para ${days < 1 ? 'menos de 1 día' : `unos ${days} día${days === 1 ? '' : 's'}`}.`;
  if (plan.shortfall > 0) return { warn: true, text: `${base} Tu tratamiento dura ${plan.daysTreatment} días: te faltarían ${plan.shortfall} unidades.` };
  return { warn: false, text: `${base} Te avisaremos 2 días antes de que se acaben.` };
}

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
  const [intervalHours, setIntervalHours] = useState(med?.intervalHours || 8);
  const [time, setTime] = useState(
    med ? fmtTime24(med.startAt) : '08:00'
  );
  const [dayOffset, setDayOffset] = useState(0); // 0 = hoy, 1 = mañana
  const [days, setDays] = useState(med?.durationDays ? String(med.durationDays) : '');
  const [notes, setNotes] = useState(med?.notes || '');
  // Presentación (opcional): una opción de la lista, o "Otra" con texto propio.
  const savedPres = med?.presentation || '';
  const [presChip, setPresChip] = useState(PRESENTATIONS.includes(savedPres) ? savedPres : (savedPres ? OTHER : ''));
  const [presOther, setPresOther] = useState(PRESENTATIONS.includes(savedPres) ? '' : savedPres);
  // Stock (opcional): unidades que hay y unidades que se gastan en cada toma.
  const [stock, setStock] = useState(med?.stockUnits != null ? String(med.stockUnits) : '');
  const [unitsPerDose, setUnitsPerDose] = useState(String(med?.unitsPerDose || 1));
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
    const d = days.trim() === '' ? null : Number.parseInt(days, 10);
    if (d !== null && (Number.isNaN(d) || d <= 0 || d > 365)) return Alert.alert('Duración no válida', 'Indica un número de días entre 1 y 365, o déjalo vacío.');

    const stockUnits = stock.trim() === '' ? null : Number.parseInt(stock, 10);
    if (stockUnits !== null && (Number.isNaN(stockUnits) || stockUnits < 0 || stockUnits > 100000)) return Alert.alert('Cantidad no válida', 'Indica cuántas unidades tienes (un número entero), o déjalo vacío.');
    const perDose = Number.parseInt(unitsPerDose, 10);
    if (stockUnits !== null && (Number.isNaN(perDose) || perDose < 1 || perDose > 100)) return Alert.alert('Unidades por toma no válidas', 'Indica cuántas unidades gastas en cada toma (de 1 a 100).');
    const presentation = presChip === OTHER ? presOther.trim() : presChip;

    onSave({
      id: med?.id,
      name: name.trim(),
      dose: dose.trim(),
      intervalHours,
      startAt: scheduleTouched ? atDayOffset(t.h, t.m, dayOffset) : med.startAt,
      durationDays: d,
      notes: notes.trim(),
      presentation,
      stockUnits,
      unitsPerDose: stockUnits === null ? 1 : perDose,
      active: med ? med.active : true,
    });
  };

  // Vista previa del stock mientras se escribe.
  const hint = stockHint(stockPlan({
    stockUnits: stock.trim() === '' || Number.isNaN(Number.parseInt(stock, 10)) ? null : Number.parseInt(stock, 10),
    unitsPerDose: Math.max(1, Number.parseInt(unitsPerDose, 10) || 1),
    intervalHours,
    durationDays: days.trim() === '' || Number.isNaN(Number.parseInt(days, 10)) ? null : Number.parseInt(days, 10),
  }));

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

          <Text style={labelStyle}>Presentación (opcional)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: presChip === OTHER ? 4 : 10 }}>
            {[...PRESENTATIONS, OTHER].map((p) => (
              <Chip key={p} label={p} selected={presChip === p} onPress={() => setPresChip(presChip === p ? '' : p)} />
            ))}
          </View>
          {presChip === OTHER && <Field label="¿Cuál presentación?" value={presOther} onChangeText={setPresOther} placeholder="Ej. Parche" />}

          <Text style={labelStyle}>Frecuencia: cada cuántas horas</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
            {INTERVALS.map((h) => (
              <Chip key={h} label={`${h} h`} selected={intervalHours === h} onPress={() => touch(setIntervalHours)(h)} />
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
          <Field
            label="Unidades disponibles (opcional)"
            value={stock}
            onChangeText={setStock}
            placeholder="Ej. 30"
            keyboardType="number-pad"
            hint="Las que hay en la caja o el frasco. Se descuentan solas al marcar cada toma."
          />
          {stock.trim() !== '' && (
            <Field
              label="Unidades que gastas en cada toma"
              value={unitsPerDose}
              onChangeText={setUnitsPerDose}
              placeholder="1"
              keyboardType="number-pad"
              hint="Ej. 2 si tomas 2 tabletas cada vez, o 10 si son 10 gotas."
            />
          )}
          {hint && <Text style={{ fontSize: 14, marginBottom: 14, color: hint.warn ? colors.warn : colors.primaryDark }}>{hint.text}</Text>}
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
