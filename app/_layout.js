// Layout raíz de Expo Router: proveedor de estado global y pila de navegación.
// Rutas: (tabs) = pestañas principales; med-form, scan, profile, account y settings = pantallas completas.
// DrawerMenu es el menú lateral (se abre desde el encabezado de las pestañas).
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProvider, useApp } from '../src/context/AppContext';
import { DrawerProvider } from '../src/context/DrawerContext';
import DrawerMenu from '../src/components/DrawerMenu';
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
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="med-form" />
        <Stack.Screen name="scan" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="account" />
        <Stack.Screen name="settings" />
      </Stack>
      <DrawerMenu />
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <DrawerProvider>
        <StatusBar style="light" backgroundColor={colors.primary} />
        <RootStack />
      </DrawerProvider>
    </AppProvider>
  );
}
