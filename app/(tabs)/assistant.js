// Ruta "/assistant" (pestaña Asistente): chat con la IA limitado a temas médicos y de salud.
// - Aviso fijo arriba: no reemplaza la asesoría médica.
// - La restricción de contexto vive en src/services/assistant.js (instrucciones de sistema).
// - Opcional: el usuario puede compartir como contexto sus medicamentos y datos de perfil (edad, estatura, peso, observaciones) (apagado por defecto,
//   porque esos datos se envían al servicio de IA).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Keyboard, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../src/components/UI';
import { colors, font, radius } from '../../src/theme';
import { useApp } from '../../src/context/AppContext';
import { askAssistant } from '../../src/services/assistant';
import { fmtInterval } from '../../src/utils/time';

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  local: true, // mensaje de bienvenida: no se envía al modelo
  content: 'Hola, soy tu asistente de salud. Puedo ayudarte con dudas sobre medicamentos, síntomas y hábitos saludables. ¿En qué te ayudo?',
};

const SUGGESTIONS = [
  '¿Qué hago si olvidé una dosis?'
];

let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

export default function AssistantScreen() {
  const { meds, profile } = useApp();
  const [messages, setMessages] = useState([WELCOME]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [useContext, setUseContext] = useState(false);
  const listRef = useRef(null);

  // Texto de contexto (solo si el usuario lo permite): datos del perfil + medicamentos activos.
  // No se envían nombre, correo ni foto.
  const contextText = useMemo(() => {
    if (!useContext) return null;
    const active = meds.filter((m) => m.active);
    const lines = active.map((m) => {
      const ingredient = m.activeIngredient ? ` (${m.activeIngredient})` : '';
      return `- ${m.name}${ingredient}: ${m.dose}, ${fmtInterval(m.intervalHours).toLowerCase()}`;
    });
    const data = [
      profile.age ? `Edad: ${profile.age} años` : null,
      profile.heightCm ? `Estatura: ${profile.heightCm} cm` : null,
      profile.weightKg ? `Peso: ${profile.weightKg} kg` : null,
      profile.heightCm && profile.weightKg ? `IMC aproximado: ${(profile.weightKg / (profile.heightCm / 100) ** 2).toFixed(1)}` : null,
      profile.observations ? `Observaciones (condiciones, alergias): ${profile.observations}` : null,
    ].filter(Boolean);
    return `Datos del usuario:\n${data.length ? data.join('\n') : '(sin datos de perfil)'}\n\nMedicamentos activos:\n${lines.length ? lines.join('\n') : '(ninguno registrado)'}`;
  }, [useContext, meds, profile]);

  // Al abrir el teclado, la lista baja hasta el último mensaje para que se vea junto a la caja de texto.
  useEffect(() => {
    const ev = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(ev, () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60));
    return () => sub.remove();
  }, []);

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

  const send = async (raw) => {
    const content = (raw ?? text).trim();
    if (!content || loading) return;
    const userMsg = { id: nextId(), role: 'user', content };
    const next = [...messages, userMsg];
    setMessages(next);
    setText('');
    setLoading(true);
    scrollEnd();
    try {
      // Solo se envían los mensajes reales (sin bienvenida ni errores).
      const history = next.filter((m) => !m.local && !m.error).map((m) => ({ role: m.role, content: m.content }));
      const answer = await askAssistant(history, contextText);
      setMessages((cur) => [...cur, { id: nextId(), role: 'assistant', content: answer }]);
    } catch (e) {
      setMessages((cur) => [...cur, { id: nextId(), role: 'assistant', error: true, content: e.message }]);
    } finally {
      setLoading(false);
      scrollEnd();
    }
  };

  const reset = () => setMessages([WELCOME]);
  const onlyWelcome = messages.length === 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        title="Asistente de salud"
        subtitle="Solo temas médicos"
        right={
          <TouchableOpacity onPress={reset} style={s.headBtn} accessibilityRole="button" accessibilityLabel="Nueva conversación">
            <Ionicons name="create-outline" size={26} color={colors.white} />
          </TouchableOpacity>
        }
      />

      {/* Aviso fijo: no reemplaza la asesoría médica */}
      <View style={s.notice} accessibilityRole="alert">
        <Ionicons name="information-circle" size={22} color={colors.warn} />
        <Text style={s.noticeText}>
          Este asistente <Text style={{ fontWeight: '800' }}>no reemplaza la asesoría médica</Text>. Ante una emergencia llama al 123 o acude a urgencias.
        </Text>
      </View>

      {/* El contenedor se encoge cuando aparece el teclado, así la caja de texto nunca queda tapada */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollEnd}
          renderItem={({ item }) => (
            <View style={[s.row, item.role === 'user' && { justifyContent: 'flex-end' }]}>
              <View style={[s.bubble, item.role === 'user' ? s.user : s.bot, item.error && s.err]}>
                <Text style={[s.msg, item.role === 'user' && { color: colors.white }, item.error && { color: colors.danger }]} selectable>
                  {item.content}
                </Text>
              </View>
            </View>
          )}
          ListFooterComponent={
            <View>
              {loading && (
                <View style={[s.row]}>
                  <View style={[s.bubble, s.bot, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={s.msg}>Escribiendo...</Text>
                  </View>
                </View>
              )}
              {onlyWelcome && !loading && (
                <View style={{ marginTop: 8 }}>
                  <Text style={s.sugTitle}>Prueba preguntar:</Text>
                  {SUGGESTIONS.map((q) => (
                    <TouchableOpacity key={q} style={s.sug} onPress={() => send(q)} accessibilityRole="button">
                      <Text style={s.sugText}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          }
        />

        {/* Compartir medicamentos como contexto (opcional) */}
        <View style={s.ctxRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={s.ctxTitle}>Usar mis datos y medicamentos como contexto</Text>
            <Text style={s.ctxDesc}>{useContext ? 'Se envían tu edad, estatura, peso, observaciones y medicamentos.' : 'Apagado: el asistente no ve tus datos.'}</Text>
          </View>
          <Switch
            value={useContext}
            onValueChange={setUseContext}
            trackColor={{ true: colors.primaryMid, false: '#CCCCCC' }}
            thumbColor={useContext ? colors.primary : '#F4F4F4'}
            accessibilityLabel="Usar mis datos y medicamentos como contexto"
          />
        </View>

        {/* Caja de mensaje */}
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder="Escribe tu pregunta de salud..."
            placeholderTextColor="#98A89B"
            multiline
            maxLength={600}
            editable={!loading}
          />
          <TouchableOpacity
            style={[s.send, (!text.trim() || loading) && { opacity: 0.45 }]}
            onPress={() => send()}
            disabled={!text.trim() || loading}
            accessibilityRole="button"
            accessibilityLabel="Enviar"
          >
            <Ionicons name="send" size={22} color={colors.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  headBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.warnBg, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#FFE0B2' },
  noticeText: { flex: 1, fontSize: 14, color: '#6B3A00', lineHeight: 20 },
  row: { flexDirection: 'row', marginBottom: 10 },
  bubble: { maxWidth: '86%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bot: { backgroundColor: colors.primaryLight, borderTopLeftRadius: 4 },
  user: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
  err: { backgroundColor: '#FDECEA' },
  msg: { fontSize: font.body, color: colors.text, lineHeight: 24 },
  sugTitle: { fontSize: 14, fontWeight: '800', color: colors.primaryDark, marginBottom: 6 },
  sug: { borderWidth: 2, borderColor: colors.primaryMid, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, backgroundColor: colors.white },
  sugText: { fontSize: 15, color: colors.primaryDark, fontWeight: '600' },
  ctxRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  ctxTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  ctxDesc: { fontSize: 12, color: colors.muted, marginTop: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10 },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderWidth: 2, borderColor: colors.primaryMid, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, fontSize: font.body, color: colors.text, backgroundColor: colors.white },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
