// Componentes de interfaz reutilizables con el tema verde/blanco.
import React from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDrawer } from '../context/DrawerContext';
import { useApp } from '../context/AppContext';
import { colors, radius, font } from '../theme';

// Iniciales de un nombre ("María López" -> "ML").
export function initialsOf(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Foto redonda del usuario. Sin foto muestra sus iniciales; sin nombre, un icono de persona.
export function Avatar({ uri, name, size = 40, bg = colors.white, fg = colors.primary }) {
  const base = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={[base, { backgroundColor: colors.primaryLight }]} accessibilityLabel="Foto del usuario" />;
  const ini = initialsOf(name);
  return (
    <View style={[base, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
      {ini ? (
        <Text style={{ fontSize: size * 0.4, fontWeight: '800', color: fg }}>{ini}</Text>
      ) : (
        <Ionicons name="person" size={size * 0.55} color={fg} />
      )}
    </View>
  );
}

// Encabezado verde con título y acción a la derecha.
// Arriba a la izquierda: botón de volver (si hay onBack) o la FOTO del usuario con su nombre debajo,
// que abre el menú lateral.
export function Header({ title, subtitle, onBack, right }) {
  const insets = useSafeAreaInsets();
  const { open } = useDrawer();
  const { profile } = useApp();
  const firstName = (profile?.fullName || '').trim().split(/\s+/)[0];
  return (
    <View style={[s.header, { paddingTop: insets.top + 12 }]}>
      <View style={s.headerRow}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={s.back} accessibilityLabel="Volver">
            <Text style={s.backText}>‹ Volver</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={open} style={s.menu} accessibilityRole="button" accessibilityLabel="Abrir menú">
            <Avatar uri={profile?.photoUrl} name={profile?.fullName} size={42} />
            <Text style={s.menuName} numberOfLines={1}>{firstName || 'Menú'}</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>{title}</Text>
          {subtitle ? <Text style={s.headerSub}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

// Botón grande (mínimo 48 px de alto). Variantes: primary, outline, danger, ghost.
export function Button({ title, onPress, variant = 'primary', disabled, small, style }) {
  const v = {
    primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
    outline: { bg: colors.white, fg: colors.primary, border: colors.primary },
    danger: { bg: colors.white, fg: colors.danger, border: colors.danger },
    ghost: { bg: colors.primaryLight, fg: colors.primaryDark, border: colors.primaryLight },
  }[variant];
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[
        s.btn,
        { backgroundColor: v.bg, borderColor: v.border, minHeight: small ? 44 : 52 },
        disabled && { opacity: 0.5 },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={[s.btnText, { color: v.fg, fontSize: small ? 15 : font.body }]}>{title}</Text>
    </TouchableOpacity>
  );
}

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

// Opción seleccionable (para frecuencia, día de inicio, etc.).
export function Chip({ label, selected, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[s.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
    >
      <Text style={[s.chipText, selected && { color: colors.white }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Campo de texto con etiqueta.
export function Field({ label, hint, style, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#98A89B"
        style={[s.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, style]}
        {...props}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

// Etiqueta pequeña de estado (Pendiente, Atrasada, Tomada...).
export function Badge({ text, color = colors.primaryDark, bg = colors.primaryLight }) {
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: colors.primary, paddingHorizontal: 18, paddingBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { color: colors.white, fontSize: font.title, fontWeight: '800' },
  headerSub: { color: '#DDF0DE', fontSize: font.small, marginTop: 2 },
  menu: { width: 64, minHeight: 44, marginLeft: -6, marginRight: 8, alignItems: 'center', justifyContent: 'center' },
  menuName: { color: '#DDF0DE', fontSize: 11, fontWeight: '700', marginTop: 2, maxWidth: 64 },
  back: { marginRight: 12, paddingVertical: 6 },
  backText: { color: colors.white, fontSize: font.body, fontWeight: '600' },
  btn: {
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontWeight: '700' },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  chip: {
    borderWidth: 2,
    borderColor: colors.primaryMid,
    backgroundColor: colors.white,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: { color: colors.primaryDark, fontWeight: '700', fontSize: 15 },
  label: { fontSize: 15, fontWeight: '700', color: colors.primaryDark, marginBottom: 6 },
  input: {
    borderWidth: 2,
    borderColor: colors.primaryMid,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.white,
  },
  hint: { fontSize: 13, color: colors.muted, marginTop: 4 },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 13, fontWeight: '700' },
});
