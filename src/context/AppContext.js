// Contexto global: sesión, medicamentos, tomas de hoy, perfil y ajustes, leídos de la base de datos SQLite.
// Se monta en app/_layout.js para que todas las rutas compartan el mismo estado.
//
// Cada acción (Tomé / Aplazar / Omitir / editar...) escribe en la BD, vuelve a leer los datos
// y reprograma las notificaciones, de modo que la pantalla siempre refleja lo guardado.
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as repo from '../db/repository';
import { getDb } from '../db/database';
import { configureNotifications, ensurePermissions, ensureChannel, rescheduleAll } from '../services/notifications';
import { findReferenceImage } from '../services/imageSearch';
import * as auth from '../services/auth';
import { dayKey } from '../utils/time';

configureNotifications();

const EMPTY_PROFILE = { email: '', provider: 'local', photoUrl: null, fullName: '', age: null, heightCm: null, weightKg: null, observations: '' };

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [meds, setMeds] = useState([]);
  const [todayDoses, setTodayDoses] = useState([]);
  const [session, setSession] = useState(null); // usuario con la sesión iniciada (null = sin sesión)
  const sessionRef = useRef(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [settings, setSettings] = useState({ sound: true, vibrate: true });
  const settingsRef = useRef(settings); // copia para usarla dentro de callbacks sin quedar desactualizada
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const lastDay = useRef(dayKey(Date.now()));

  // Vuelve a leer la BD y reprograma los recordatorios.
  const refresh = useCallback(async () => {
    const [m, t, upcoming] = await Promise.all([repo.listMeds(), repo.getTodayDoses(), repo.getUpcomingDoses(60)]);
    setMeds(m);
    setTodayDoses(t);
    rescheduleAll(upcoming, settingsRef.current).catch((e) => console.warn('Error reprogramando notificaciones:', e));
  }, []);

  // Carga los datos del usuario que acaba de entrar (o que ya tenía sesión).
  const enterSession = useCallback(async (user) => {
    sessionRef.current = user;
    setSession(user);
    setProfile(await repo.getProfile());
    await repo.ensureDoses();
    await repo.autoSkipExpired();
    await repo.purgeFinishedMeds(); // quita los tratamientos cuya duración ya terminó
    await refresh();
  }, [refresh]);

  // Carga inicial: abre la BD, recupera la sesión (si existe) y pide permisos.
  useEffect(() => {
    (async () => {
      try {
        await getDb();
        const savedSettings = await repo.getSettings();
        settingsRef.current = savedSettings;
        setSettings(savedSettings);
        const user = await auth.getSession();
        if (user) await enterSession(user);
      } catch (error) {
        console.warn('Error iniciando la base de datos:', error);
      }
      try {
        await ensurePermissions(settingsRef.current);
      } catch (error) {
        console.warn('Error configurando notificaciones:', error);
      }
      readyRef.current = true;
      setReady(true);
    })();
  }, [enterSession]);

  // Vigilante: omite solo las tomas que agotaron sus aplazos y cambia de día a medianoche.
  const tick = useCallback(async () => {
    if (!readyRef.current || !sessionRef.current) return;
    try {
      const skipped = await repo.autoSkipExpired();
      const finished = await repo.purgeFinishedMeds(); // tratamientos que acaban de terminar
      const today = dayKey(Date.now());
      if (today !== lastDay.current) {
        lastDay.current = today;
        await repo.ensureDoses();
        await refresh();
      } else if (skipped > 0 || finished.length > 0) {
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

  // ---- Sesión: registrarse, entrar (correo o Google) y cerrar sesión ----
  const signUp = useCallback(async (data) => enterSession(await auth.register(data)), [enterSession]);
  const signIn = useCallback(async (data) => enterSession(await auth.login(data)), [enterSession]);
  const signInGoogle = useCallback(async () => {
    const user = await auth.loginWithGoogle();
    if (user) await enterSession(user);
    return !!user; // false = la persona canceló el selector de Google
  }, [enterSession]);

  const signOut = useCallback(async () => {
    await auth.logout();
    sessionRef.current = null;
    await rescheduleAll([], settingsRef.current).catch(() => {}); // cancela los recordatorios de este usuario
    setMeds([]);
    setTodayDoses([]);
    setProfile(EMPTY_PROFILE);
    setSession(null); // el layout redirige solo a la pantalla de login
  }, []);

  // ---- Perfil ----
  const saveProfile = useCallback(async (p) => {
    await repo.saveProfile(p);
    setProfile(await repo.getProfile());
  }, []);

  // ---- Ajustes de sonido y vibración: se guardan, se crea el canal y se reprograman los avisos ----
  const updateSettings = useCallback(async (patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    await repo.saveSettings(next);
    await ensureChannel(next);
    await refresh();
  }, [refresh]);

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
    meds, todayDoses, ready, session, profile, settings, saveProfile, updateSettings,
    signUp, signIn, signInGoogle, signOut,
    takeDose, skipDose, snoozeDose, undoDose,
    saveMed, saveMany, deleteMed, toggleActive, fetchImage,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
