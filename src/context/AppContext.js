// Contexto global: medicamentos y tomas de hoy, leídos de la base de datos SQLite.
// Se monta en app/_layout.js para que todas las rutas compartan el mismo estado.
//
// Cada acción (Tomé / Aplazar / Omitir / editar...) escribe en la BD, vuelve a leer los datos
// y reprograma las notificaciones, de modo que la pantalla siempre refleja lo guardado.
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as repo from '../db/repository';
import { getDb } from '../db/database';
import { configureNotifications, ensurePermissions, rescheduleAll } from '../services/notifications';
import { findReferenceImage } from '../services/imageSearch';
import { dayKey } from '../utils/time';

configureNotifications();

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [meds, setMeds] = useState([]);
  const [todayDoses, setTodayDoses] = useState([]);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const lastDay = useRef(dayKey(Date.now()));

  // Vuelve a leer la BD y reprograma los recordatorios.
  const refresh = useCallback(async () => {
    const [m, t, upcoming] = await Promise.all([repo.listMeds(), repo.getTodayDoses(), repo.getUpcomingDoses(60)]);
    setMeds(m);
    setTodayDoses(t);
    rescheduleAll(upcoming).catch((e) => console.warn('Error reprogramando notificaciones:', e));
  }, []);

  // Carga inicial: abre la BD, genera tomas, aplica omisiones pendientes y pide permisos.
  useEffect(() => {
    (async () => {
      try {
        await getDb();
        await repo.ensureDoses();
        await repo.autoSkipExpired();
        await refresh();
      } catch (error) {
        console.warn('Error iniciando la base de datos:', error);
      }
      try {
        await ensurePermissions();
      } catch (error) {
        console.warn('Error configurando notificaciones:', error);
      }
      readyRef.current = true;
      setReady(true);
    })();
  }, [refresh]);

  // Vigilante: omite solo las tomas que agotaron sus aplazos y cambia de día a medianoche.
  const tick = useCallback(async () => {
    if (!readyRef.current) return;
    try {
      const skipped = await repo.autoSkipExpired();
      const today = dayKey(Date.now());
      if (today !== lastDay.current) {
        lastDay.current = today;
        await repo.ensureDoses();
        await refresh();
      } else if (skipped > 0) {
        await refresh();
      }
    } catch (e) {
      console.warn('Error en el vigilante de tomas:', e);
    }
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(tick, 5000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && tick());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [tick]);

  // ---- Acciones sobre tomas (cada una actúa solo sobre SU toma) ----
  const act = (fn) => async (id) => {
    const res = await fn(id);
    await refresh();
    return res;
  };
  const takeDose = useCallback(act(repo.takeDose), [refresh]);
  const skipDose = useCallback(act(repo.skipDose), [refresh]);
  const snoozeDose = useCallback(act(repo.snoozeDose), [refresh]);
  const undoDose = useCallback(act(repo.undoDose), [refresh]);

  // ---- Imagen de referencia ----
  const fetchImage = useCallback(async (med) => {
    const img = await findReferenceImage({ name: med.name, activeIngredient: med.activeIngredient });
    if (img) {
      await repo.updateMedicationImage(med.id, { imageUrl: img.url, imageSource: img.source });
      await refresh();
    }
    return img;
  }, [refresh]);

  // ---- Acciones sobre medicamentos ----
  const saveMed = useCallback(async (data) => {
    const id = await repo.saveMedication(data);
    await refresh();
    // Si no tiene imagen, se busca en segundo plano (no hace esperar al usuario).
    if (!data.imageUrl) {
      findReferenceImage({ name: data.name, activeIngredient: data.activeIngredient })
        .then(async (img) => {
          if (img) {
            await repo.updateMedicationImage(id, { imageUrl: img.url, imageSource: img.source });
            await refresh();
          }
        })
        .catch(() => {});
    }
    return id;
  }, [refresh]);

  const saveMany = useCallback(async (arr) => {
    for (const m of arr) await repo.saveMedication(m);
    await refresh();
  }, [refresh]);

  const deleteMed = useCallback(async (id) => {
    await repo.deleteMedication(id);
    await refresh();
  }, [refresh]);

  const toggleActive = useCallback(async (id) => {
    const med = meds.find((m) => m.id === id);
    if (!med) return;
    await repo.setMedicationActive(id, !med.active);
    await refresh();
  }, [meds, refresh]);

  const value = {
    meds, todayDoses, ready,
    takeDose, skipDose, snoozeDose, undoDose,
    saveMed, saveMany, deleteMed, toggleActive, fetchImage,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
