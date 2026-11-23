// Diálogos que funcionan igual en el teléfono y en la web.
// (En la web, Alert.alert de React Native no muestra nada; aquí se usa window.alert / window.confirm.)
import { Alert, Platform } from 'react-native';

// Aviso simple con un botón "OK".
export function notify(title, message) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

// Pregunta de confirmación. Devuelve una promesa: true si el usuario acepta, false si cancela.
export function confirmAction(title, message, okLabel = 'Aceptar', destructive = false) {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
