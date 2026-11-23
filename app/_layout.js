// Layout raíz de Expo Router: proveedor de estado global y pila de navegación.
// Rutas con sesión: (tabs), med-form, scan, profile, account y settings.
// Ruta sin sesión: login. Stack.Protected redirige solo cuando la sesión cambia (iniciar / cerrar sesión).
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
  const { ready, session } = useApp();
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
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="med-form" />
          <Stack.Screen name="scan" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="account" />
          <Stack.Screen name="settings" />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      {/* El menú lateral solo existe con sesión iniciada */}
      {session ? <DrawerMenu /> : null}
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
