// Menú lateral que se desliza desde la izquierda (sin librerías extra: Animated + PanResponder).
// - Se abre con el botón de hamburguesa del encabezado o deslizando desde el borde izquierdo (ver DrawerEdgeSwipe).
// - Se cierra tocando fuera del panel, deslizándolo a la izquierda o con el botón "atrás" de Android.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, Modal, PanResponder, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDrawer } from '../context/DrawerContext';
import { useApp } from '../context/AppContext';
import { colors, font } from '../theme';

// Opciones del menú: cada una abre una ruta de app/.
const ITEMS = [
  { label: 'Perfil', icon: 'person-outline', path: '/profile' },
  { label: 'Cuenta', icon: 'shield-checkmark-outline', path: '/account' },
  { label: 'Configuraciones', icon: 'settings-outline', path: '/settings' },
];

// Iniciales para el círculo del encabezado ("María López" -> "ML").
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export default function DrawerMenu() {
  const { visible, close } = useDrawer();
  const { profile } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const width = Math.min(Dimensions.get('window').width * 0.8, 320);
  const x = useRef(new Animated.Value(-width)).current; // posición horizontal del panel
  const [mounted, setMounted] = useState(false);        // el Modal sigue montado durante la animación de cierre

  // Anima la apertura y el cierre.
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(x, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(x, { toValue: -width, duration: 200, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deslizar el panel hacia la izquierda lo cierra.
  const closeRef = useRef(close);
  closeRef.current = close;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx < -10 && Math.abs(g.dy) < 20,
        onPanResponderMove: (_, g) => x.setValue(Math.min(0, g.dx)),
        onPanResponderRelease: (_, g) => {
          if (g.dx < -width / 3) closeRef.current();
          else Animated.timing(x, { toValue: 0, duration: 150, useNativeDriver: true }).start();
        },
      }),
    [width, x]
  );

  const go = (path) => {
    close();
    router.push(path);
  };

  // "Cerrar sesión" todavía no tiene funcionalidad: solo avisa.
  const logout = () => {
    close();
    Alert.alert('Cerrar sesión', 'Esta función aún no está disponible.');
  };

  const backdrop = x.interpolate({ inputRange: [-width, 0], outputRange: [0, 0.45] });

  return (
    <Modal transparent visible={mounted} animationType="none" statusBarTranslucent onRequestClose={close}>
      <View style={StyleSheet.absoluteFill}>
        {/* Fondo oscuro: al tocarlo se cierra el menú */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: backdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Cerrar menú" />
        </Animated.View>

        <Animated.View style={[s.panel, { width, transform: [{ translateX: x }] }]} {...pan.panHandlers}>
          {/* Cabecera verde con el nombre del perfil */}
          <View style={[s.head, { paddingTop: insets.top + 20 }]}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials(profile.fullName)}</Text>
            </View>
            <Text style={s.name} numberOfLines={2}>{profile.fullName || 'MediRecuerda'}</Text>
            <Text style={s.sub}>{profile.fullName ? 'MediRecuerda' : 'Completa tu perfil'}</Text>
          </View>

          {ITEMS.map((it) => (
            <TouchableOpacity key={it.path} style={s.item} onPress={() => go(it.path)} accessibilityRole="button" accessibilityLabel={it.label}>
              <Ionicons name={it.icon} size={26} color={colors.primary} />
              <Text style={s.itemText}>{it.label}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </TouchableOpacity>
          ))}

          {/* Cerrar sesión: al fondo del menú (sin funcionalidad por ahora) */}
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={[s.item, s.logout, { paddingBottom: insets.bottom, minHeight: 60 + insets.bottom }]}
            onPress={logout}
            accessibilityRole="button"
            accessibilityLabel="Cerrar sesión"
          >
            <Ionicons name="log-out-outline" size={26} color={colors.danger} />
            <Text style={[s.itemText, { color: colors.danger }]}>Cerrar sesión</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.white, elevation: 16 },
  head: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingBottom: 22 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 24, fontWeight: '800', color: colors.primary },
  name: { color: colors.white, fontSize: 20, fontWeight: '800' },
  sub: { color: '#DDF0DE', fontSize: 14, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 60, borderBottomWidth: 1, borderBottomColor: colors.border },
  logout: { borderTopWidth: 1, borderTopColor: colors.border, borderBottomWidth: 0 },
  itemText: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text },
});
