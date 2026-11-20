// Layout raíz de Expo Router: proveedor de estado global y pila de navegación.
// Rutas: (tabs) = pestañas principales; med-form y scan = pantallas completas.
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from '../src/context/AppContext';
import { colors } from '../src/theme';

function RootStack() {
  const { ready } = useApp();
  // Mientras se cargan los datos guardados se muestra un indicador.
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="med-form" />
      <Stack.Screen name="scan" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="light" backgroundColor={colors.primary} />
      <RootStack />
    </AppProvider>
  );
}
