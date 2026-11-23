// Estado del menú lateral (abierto/cerrado). Lo usa el botón de hamburguesa del encabezado
// y el componente DrawerMenu que dibuja el panel deslizable.
import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

const DrawerContext = createContext({ visible: false, open: () => {}, close: () => {} });
export const useDrawer = () => useContext(DrawerContext);

export function DrawerProvider({ children }) {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const value = useMemo(() => ({ visible, open, close }), [visible, open, close]);
  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}
