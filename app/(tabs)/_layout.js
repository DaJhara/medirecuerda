// Layout de las pestañas inferiores (Hoy, Medicamentos, Historial).
// Incluye la zona de deslizamiento que abre el menú lateral desde el borde izquierdo.
import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../src/theme';
import DrawerEdgeSwipe from '../../src/components/DrawerEdgeSwipe';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontSize: 13,
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
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="today-outline" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="meds"
        options={{
          title: 'Medicamentos',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="medkit-outline" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: 'Historial',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
    <DrawerEdgeSwipe />
    </View>
  );
}
