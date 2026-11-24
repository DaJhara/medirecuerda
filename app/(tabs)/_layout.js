// Layout de las pestañas inferiores (Hoy, Medicamentos, Historial y Asistente).
// Incluye la zona de deslizamiento que abre el menú lateral desde el borde izquierdo.
import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../src/theme';
import DrawerEdgeSwipe from '../../src/components/DrawerEdgeSwipe';

// Iconos de las pestañas: se crean fuera del componente para no redefinirlos en cada render.
const tabIcon = (name) =>
  function TabIcon({ color, size }) {
    return <Ionicons name={name} size={size} color={color} />;
  };

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true, // oculta la barra inferior al escribir (deja espacio a la caja de texto)
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontSize: 12, // 4 pestañas: texto un poco más pequeño para que quepa "Medicamentos"
          fontWeight: '700',
        },
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Hoy',
          tabBarIcon: tabIcon('today-outline'),
        }}
      />

      <Tabs.Screen
        name="meds"
        options={{
          title: 'Medicamentos',
          tabBarIcon: tabIcon('medkit-outline'),
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: 'Historial',
          tabBarIcon: tabIcon('stats-chart-outline'),
        }}
      />

      <Tabs.Screen
        name="assistant"
        options={{
          title: 'Asistente',
          tabBarIcon: tabIcon('chatbubbles-outline'),
        }}
      />
    </Tabs>
    <DrawerEdgeSwipe />
    </View>
  );
}
