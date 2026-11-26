// Texto y campo de texto que respetan el tamaño de letra elegido en Configuraciones (opcional, para personas mayores).
// Se usan igual que <Text> y <TextInput> de React Native: solo multiplican el fontSize (y el lineHeight) por el factor
// guardado en los ajustes (1 = normal). Con el factor en 1 no cambian nada.
import React from 'react';
import { Text as RNText, TextInput as RNTextInput, StyleSheet } from 'react-native';
import { useApp } from '../context/AppContext';

const BASE_SIZE = 14; // tamaño que usa React Native cuando el estilo no indica ninguno

// Devuelve el estilo con las medidas de letra escaladas (o el mismo estilo si el factor es 1).
function scaleStyle(style, scale, fallbackSize) {
  if (!scale || scale === 1) return style;
  const flat = StyleSheet.flatten(style) || {};
  const out = { ...flat, fontSize: (flat.fontSize ?? fallbackSize) * scale };
  if (typeof flat.lineHeight === 'number') out.lineHeight = flat.lineHeight * scale;
  return out;
}

export function Text({ style, ...props }) {
  const scale = useApp()?.settings?.fontScale;
  return <RNText {...props} style={scaleStyle(style, scale, BASE_SIZE)} />;
}

export const TextInput = React.forwardRef(function TextInput({ style, ...props }, ref) {
  const scale = useApp()?.settings?.fontScale;
  return <RNTextInput {...props} ref={ref} style={scaleStyle(style, scale, BASE_SIZE)} />;
});
