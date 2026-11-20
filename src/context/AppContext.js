// Contexto global: medicamentos, registro de tomas y acciones.
// Se monta en app/_layout.js para que todas las rutas compartan el mismo estado.
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { loadMeds, saveMeds, loadLog, saveLog, newId } from '../services/storage';
import { configureNotifications, ensurePermissions, rescheduleAll, scheduleSnooze } from '../services/notifications';

configureNotifications();

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [meds, setMeds] = useState([]);
  const [log, setLog] = useState({});
  const [ready, setReady] = useState(false);


  // Carga inicial de datos y permisos de notificaciones.
  useEffect(() => {
    (async () => {
      const savedMeds = await loadMeds();
      const savedLog = await loadLog();

      setMeds(savedMeds);
      setLog(savedLog);

      try {
        await ensurePermissions();
      } catch (error) {
        console.warn('Error configurando notificaciones:', error);
      }

      setReady(true);
    })();
  }, []);


  // Cada cambio: guarda en el teléfono y reprograma los recordatorios.
  useEffect(() => {
    if (!ready) return;
    saveMeds(meds);
    saveLog(log);
    rescheduleAll(meds, log).catch(() => {});
  }, [meds, log, ready]);

  // Acciones sobre tomas
  
  const setStatus = useCallback((key, status, until = null) =>
    setLog((l) => ({
      ...l,
      [key]: {
        status,
        at: Date.now(),
        ...(until ? { until } : {}),
      },
    })),
  []);
  const clearStatus = useCallback((key) => setLog((l) => { const n = { ...l }; delete n[key]; return n; }), []);

  // Acciones sobre medicamentos
  const saveMed = useCallback((data) => {
    setMeds((list) => (data.id ? list.map((m) => (m.id === data.id ? { ...m, ...data } : m)) : [...list, { ...data, id: newId() }]));
  }, []);
  const saveMany = useCallback((arr) => setMeds((list) => [...list, ...arr.map((m) => ({ ...m, id: newId() }))]), []);
  const deleteMed = useCallback((id) => setMeds((l) => l.filter((m) => m.id !== id)), []);
  const toggleActive = useCallback((id) => setMeds((l) => l.map((m) => (m.id === id ? { ...m, active: !m.active } : m))), []);

  const value = { meds, log, ready, setStatus, clearStatus, saveMed, saveMany, deleteMed, toggleActive, snooze: scheduleSnooze };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
