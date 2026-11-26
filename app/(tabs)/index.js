// Ruta "/" (pestaña Hoy): una tarjeta por medicamento con su próxima hora de toma.
//
// - Colapsada: nombre + hora más cercana + botones Tomé / Aplazar / Omitir.
// - Al desplegar (flecha): próximas horas del día, imagen de referencia y dosis.
// - Los botones actúan solo sobre la toma de ESE medicamento.
// - Se bloquean hasta que llega la hora (también tras cada aplazamiento).
// - Máximo 2 aplazamientos; en el tercer momento, si no se marca, se omite sola a los 10 min.
import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { Text } from '../../src/components/AppText';
import { Ionicons } from '@expo/vector-icons';
import { Header, Card, Button, Badge } from '../../src/components/UI';
import { colors, font } from '../../src/theme';
import { fmtTime } from '../../src/services/schedule';
import { useApp } from '../../src/context/AppContext';
import { refillInfo, needsRefillNow } from '../../src/services/refill';
import { MAX_SNOOZES, AUTO_SKIP_MINUTES, ON_TIME_TOLERANCE_MIN, SNOOZE_MINUTES } from '../../src/db/repository';

const MIN = 60000;

// Agrupa las tomas de hoy por medicamento. Primero los que tienen toma pendiente (por hora).
function groupByMed(doses) {
  const map = new Map();
  for (const d of doses) {
    if (!map.has(d.medId)) {
      map.set(d.medId, {
        medId: d.medId, name: d.name, dose: d.dose, notes: d.notes, activeIngredient: d.activeIngredient,
        imageUrl: d.imageUrl, imageSource: d.imageSource, doses: [],
      });
    }
    map.get(d.medId).doses.push(d);
  }
  const groups = [...map.values()].map((g) => ({ ...g, focus: g.doses.find((x) => x.status === 'pending') || null }));
  return groups.sort((a, b) => (a.focus?.dueAt ?? Infinity) - (b.focus?.dueAt ?? Infinity));
}

export default function TodayScreen() {
  const { meds, todayDoses, takeDose, skipDose, snoozeDose, undoDose, fetchImage } = useApp();

  // "now" se actualiza cada segundo: así los botones se habilitan justo a la hora.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const [open, setOpen] = useState({});            // tarjetas desplegadas
  const [loadingImg, setLoadingImg] = useState({}); // búsquedas de imagen en curso

  const groups = useMemo(() => groupByMed(todayDoses), [todayDoses]);
  const done = todayDoses.filter((d) => d.status === 'taken').length;
  // Medicamentos a los que les quedan 2 días o menos de stock, o que están por terminar el tratamiento.
  const refills = useMemo(() => meds.map((m) => refillInfo(m)).filter((i) => needsRefillNow(i)), [meds]);

  const dateLabel = new Date(now).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

  const onSnooze = async (d) => {
    const res = await snoozeDose(d.id);
    if (res.ok) {
      Alert.alert(
        'Aplazado',
        res.remaining > 0
          ? `Te lo recordaremos en ${SNOOZE_MINUTES} minutos. Puedes aplazar ${res.remaining} vez más.`
          : `Te lo recordaremos en ${SNOOZE_MINUTES} minutos. Será el último aplazo.`
      );
    }
  };

  const onFindImage = async (g) => {
    setLoadingImg((s) => ({ ...s, [g.medId]: true }));
    const img = await fetchImage({ id: g.medId, name: g.name, activeIngredient: g.activeIngredient });
    setLoadingImg((s) => ({ ...s, [g.medId]: false }));
    if (!img) Alert.alert('Sin imagen', 'No se encontró una imagen de referencia. Intenta de nuevo más tarde.');
  };

  // Imagen de referencia de un medicamento: la imagen, el indicador de carga o el botón para buscarla.
  const renderReferenceImage = (g) => {
    if (g.imageUrl) {
      return (
        <View>
          <Image source={{ uri: g.imageUrl }} style={s.image} resizeMode="contain" />
          <Text style={s.caption}>
            Imagen de referencia{g.imageSource ? ` · ${g.imageSource}` : ''}. Puede no coincidir con la presentación que te entreguen.
          </Text>
        </View>
      );
    }
    if (loadingImg[g.medId]) return <ActivityIndicator color={colors.primary} />;
    return <Button title="Buscar imagen de referencia" variant="ghost" small onPress={() => onFindImage(g)} />;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Hoy" subtitle={dateLabel} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {todayDoses.length > 0 && (
          <Card style={{ backgroundColor: colors.primaryLight, borderColor: colors.primaryMid }}>
            <Text style={s.summary}>{done} de {todayDoses.length} tomas realizadas</Text>
          </Card>
        )}

        {refills.map((r) => (
          <Card key={r.message} style={{ backgroundColor: colors.warnBg, borderColor: colors.warn }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="alert-circle" size={26} color={colors.warn} />
              <Text style={{ flex: 1, marginLeft: 10, fontSize: font.small + 1, fontWeight: '700', color: colors.text }}>{r.message}</Text>
            </View>
          </Card>
        ))}

        {groups.length === 0 && (
          <Card>
            <Text style={s.emptyTitle}>No tienes tomas programadas hoy</Text>
            <Text style={s.emptyText}>Agrega tus medicamentos desde la pestaña Medicamentos.</Text>
          </Card>
        )}

        {groups.map((g) => {
          const f = g.focus;
          const reached = f ? f.dueAt <= now : false;       // ¿ya llegó la hora?
          const lastChance = f ? f.snoozeCount >= MAX_SNOOZES : false;
          const expanded = !!open[g.medId];

          return (
            <Card key={g.medId}>
              {/* Encabezado: nombre + hora más cercana + flecha para desplegar */}
              <TouchableOpacity
                style={s.head}
                onPress={() => setOpen((o) => ({ ...o, [g.medId]: !o[g.medId] }))}
                accessibilityRole="button"
                accessibilityLabel={`${g.name}, ${expanded ? 'ocultar' : 'ver'} más opciones`}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={s.name}>{g.name}</Text>
                  {f ? (
                    <View style={s.timeRow}>
                      <Text style={s.time}>{fmtTime(f.dueAt)}</Text>
                      {!reached && f.snoozeCount > 0 && <Badge text="Aplazada" />}
                      {!reached && f.snoozeCount === 0 && <Badge text="Pendiente" />}
                      {reached && lastChance && <Badge text="Última oportunidad" color={colors.warn} bg={colors.warnBg} />}
                      {reached && !lastChance && now - f.dueAt <= ON_TIME_TOLERANCE_MIN * MIN && <Badge text="Es hora" />}
                      {reached && !lastChance && now - f.dueAt > ON_TIME_TOLERANCE_MIN * MIN && (
                        <Badge text="Atrasada" color={colors.warn} bg={colors.warnBg} />
                      )}
                    </View>
                  ) : (
                    <Text style={s.doneText}>✓ Listo por hoy</Text>
                  )}
                </View>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={28} color={colors.primary} />
              </TouchableOpacity>

              {/* Botones: independientes por medicamento y bloqueados hasta la hora */}
              {f && (
                <>
                  <View style={s.actions}>
                    <Button title="Tomé" disabled={!reached} onPress={() => takeDose(f.id)} style={{ flex: 1.2 }} />
                    <Button
                      title="Aplazar"
                      variant="outline"
                      disabled={!reached || lastChance}
                      onPress={() => onSnooze(f)}
                      style={{ flex: 1 }}
                    />
                    <Button title="Omitir" variant="ghost" disabled={!reached} onPress={() => skipDose(f.id)} style={{ flex: 1 }} />
                  </View>
                  {!reached && f.snoozeCount > 0 && (
                    <Text style={s.hint}>Aplazada hasta las {fmtTime(f.dueAt)} ({f.snoozeCount} de {MAX_SNOOZES} aplazos).</Text>
                  )}
                  {reached && lastChance && (
                    <Text style={[s.hint, { color: colors.warn }]}>
                      Ya no puedes aplazar. Si no la marcas, se omitirá a las {fmtTime(f.dueAt + AUTO_SKIP_MINUTES * MIN)}.
                    </Text>
                  )}
                </>
              )}

              {/* Sección desplegable: próximas horas, imagen y dosis */}
              {expanded && (
                <View style={s.more}>
                  <Text style={s.sectionTitle}>Horas de hoy</Text>
                  {g.doses.map((d) => (
                    <View key={d.id} style={s.doseRow}>
                      <Text style={[s.doseTime, f && d.id === f.id && { color: colors.primary }]}>{fmtTime(d.dueAt)}</Text>
                      <Text style={s.doseState}>
                        {d.status === 'taken' && `Tomada ${fmtTime(d.actionAt)}`}
                        {d.status === 'skipped' && (d.autoSkipped ? 'Omitida (automática)' : 'Omitida')}
                        {d.status === 'pending' && (d.snoozeCount > 0 ? `Aplazada ×${d.snoozeCount}` : 'Pendiente')}
                      </Text>
                      {(d.status === 'taken' || (d.status === 'skipped' && !d.autoSkipped)) && (
                        <TouchableOpacity onPress={() => undoDose(d.id)} style={s.undo} accessibilityLabel="Deshacer">
                          <Text style={s.undoText}>Deshacer</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}

                  <Text style={s.sectionTitle}>Dosis</Text>
                  <Text style={s.info}>{g.dose}{g.notes ? ` · ${g.notes}` : ''}</Text>
                  {g.activeIngredient ? <Text style={s.infoMuted}>Principio activo: {g.activeIngredient}</Text> : null}

                  <Text style={s.sectionTitle}>Imagen de referencia</Text>
                  {renderReferenceImage(g)}
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  summary: { fontSize: font.body, fontWeight: '800', color: colors.primaryDark },
  emptyTitle: { fontSize: 19, fontWeight: '800', color: colors.text, marginBottom: 6 },
  emptyText: { fontSize: font.body, color: colors.muted },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  name: { fontSize: 20, fontWeight: '800', color: colors.text },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' },
  time: { fontSize: font.big, fontWeight: '800', color: colors.primaryDark },
  doneText: { fontSize: font.body, fontWeight: '700', color: colors.primary, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  hint: { fontSize: 14, color: colors.muted, marginTop: 10 },
  more: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.primaryDark, marginTop: 10, marginBottom: 6 },
  doseRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  doseTime: { width: 96, fontSize: font.body, fontWeight: '800', color: colors.text },
  doseState: { flex: 1, fontSize: 15, color: colors.muted },
  undo: { paddingVertical: 6, paddingHorizontal: 10 },
  undoText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  info: { fontSize: font.body, color: colors.text },
  infoMuted: { fontSize: 14, color: colors.muted, marginTop: 2 },
  image: { width: '100%', height: 180, borderRadius: 14, backgroundColor: colors.primaryLight },
  caption: { fontSize: 12, color: colors.muted, marginTop: 6 },
});
