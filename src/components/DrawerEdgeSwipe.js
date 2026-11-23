// Zona invisible en el borde izquierdo: al deslizar el dedo hacia la derecha se abre el menú lateral.
// Solo se monta en las pestañas (app/(tabs)/_layout.js) para no chocar con el gesto "atrás" de las demás pantallas.
import React, { useMemo } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDrawer } from '../context/DrawerContext';

export default function DrawerEdgeSwipe() {
  const { open } = useDrawer();
  const insets = useSafeAreaInsets();

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Solo reacciona a un arrastre horizontal hacia la derecha (los toques simples pasan de largo).
        onMoveShouldSetPanResponder: (_, g) => g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_, g) => {
          if (g.dx > 40 || g.vx > 0.4) open();
        },
      }),
    [open]
  );

  // Deja libre la barra de pestañas inferior (64 px + zona segura).
  return <View style={[s.edge, { bottom: 64 + insets.bottom }]} {...pan.panHandlers} />;
}

const s = StyleSheet.create({
  edge: { position: 'absolute', left: 0, top: 0, width: 20 },
});
