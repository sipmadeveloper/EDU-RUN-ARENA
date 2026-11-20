import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, clearDriveAccessToken } from './firebase';
import {
  cloudProfileToTeacherProfile,
  ensureTeacherCloudProfile,
} from './services/firebaseCloudStore';
import type { TeacherProfile } from './types/game';
import { LandingScreen } from './components/LandingScreen';
import { HowToPlayModal } from './components/HowToPlayModal';
import { StudentJoinView, type JoinedSession } from './components/StudentJoinView';
import { StudentRaceView } from './components/StudentRaceView';
import { TeacherAuthView } from './components/TeacherAuthView';
import { TeacherDashboard } from './components/TeacherDashboard';
import { Loading3D } from './components/Loading3D';

type AppRoute = 'landing' | 'student_join' | 'student_race' | 'teacher_auth' | 'teacher_dashboard';

const ROUTE_TRANSITION_COPY: Record<AppRoute, { title: string; subtitle: string }> = {
  landing: {
    title: 'Membuka Beranda Stadion...',
    subtitle: 'Menyiapkan tampilan arena 3D',
  },
  student_join: {
    title: 'Menuju Ruang Gabung Peserta...',
    subtitle: 'Siapkan kode room dan pilih karakter 3D Anda',
  },
  student_race: {
    title: 'Memasuki Lintasan Balap 3D...',
    subtitle: 'Menyambungkan ke garis start stadion',
  },
  teacher_auth: {
    title: 'Membuka Portal Guru...',
    subtitle: 'Menyiapkan autentikasi akun Google',
  },
  teacher_dashboard: {
    title: 'Memuat Dashboard Guru...',
    subtitle: 'Menyiapkan room, bank soal, dan rekap nilai',
  },
};

function readInitialRoomCodeFromUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    const paramCode = params.get('join') || params.get('code') || params.get('room') || '';
    if (paramCode.trim()) {
      return paramCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    }
    const pathMatch = window.location.pathname.match(/^\/join\/([A-Za-z0-9]{4,10})\/?$/i);
    if (pathMatch) {
      return pathMatch[1].toUpperCase();
    }
  } catch {
    // ignore URL parse error
  }
  return '';
}

function loadActiveStudentSession(): JoinedSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('edurun_active_race_session');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JoinedSession>;
    if (parsed.roomCode && parsed.participantId && parsed.reconnectToken && parsed.name && parsed.avatar) {
      return parsed as JoinedSession;
    }
  } catch {
    // ignore storage read error
  }
  return null;
}

export default function App() {
  const [initialJoinCode, setInitialJoinCode] = useState<string>(() => readInitialRoomCodeFromUrl());
  const [studentSession, setStudentSession] = useState<JoinedSession | null>(() => {
    const urlCode = readInitialRoomCodeFromUrl();
    const saved = loadActiveStudentSession();
    if (saved && (!urlCode || saved.roomCode.toUpperCase() === urlCode)) {
      return saved;
    }
    return null;
  });
  const [route, setRoute] = useState<AppRoute>(() => {
    const urlCode = readInitialRoomCodeFromUrl();
    const saved = loadActiveStudentSession();
    if (saved && (!urlCode || saved.roomCode.toUpperCase() === urlCode)) {
      return 'student_race';
    }
    if (urlCode) {
      return 'student_join';
    }
    return 'landing';
  });
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [transitionOverlay, setTransitionOverlay] = useState<{
    visible: boolean;
    fadingOut: boolean;
    title: string;
    subtitle: string;
  } | null>(null);

  const [teacherToken, setTeacherToken] = useState<string | null>(null);
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);

  const swapTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearTransitionTimers = useCallback(() => {
    if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
    if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
  }, []);

  useEffect(() => () => clearTransitionTimers(), [clearTransitionTimers]);

  const navigateWithTransition = useCallback(
    (nextRoute: AppRoute, beforeSwitch?: () => void) => {
      clearTransitionTimers();
      const copy = ROUTE_TRANSITION_COPY[nextRoute];
      setTransitionOverlay({
        visible: true,
        fadingOut: false,
        title: copy.title,
        subtitle: copy.subtitle,
      });

      swapTimerRef.current = window.setTimeout(() => {
        if (beforeSwitch) beforeSwitch();
        setRoute(nextRoute);
      }, 170);

      fadeTimerRef.current = window.setTimeout(() => {
        setTransitionOverlay((prev) => (prev ? { ...prev, fadingOut: true } : null));
      }, 420);

      hideTimerRef.current = window.setTimeout(() => {
        setTransitionOverlay(null);
      }, 720);
    },
    [clearTransitionTimers]
  );

  // Restore teacher session automatically from Firebase Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setTeacherToken(null);
        setTeacherProfile(null);
        return;
      }
      try {
        const cloudProfile = await ensureTeacherCloudProfile(user, null);
        setTeacherToken(user.uid);
        setTeacherProfile(cloudProfileToTeacherProfile(user.uid, cloudProfile));
      } catch {
        // Ignore transient network errors; user can re-sign in via Portal Guru
      }
    });
    return () => unsub();
  }, []);

  const clearSavedRaceSession = useCallback(() => {
    try {
      sessionStorage.removeItem('edurun_active_race_session');
    } catch {
      // ignore
    }
  }, []);

  const clearJoinQueryFromUrl = useCallback(() => {
    try {
      if (window.location.search || window.location.pathname.startsWith('/join/')) {
        window.history.replaceState({}, '', '/');
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <>
      {route === 'landing' && (
        <LandingScreen
          onJoinMatch={() => navigateWithTransition('student_join')}
          onTeacherPortal={() =>
            navigateWithTransition(
              teacherToken && teacherProfile ? 'teacher_dashboard' : 'teacher_auth'
            )
          }
          onShowHowToPlay={() => setShowHowToPlay(true)}
        />
      )}

      {route === 'student_join' && (
        <StudentJoinView
          initialCode={initialJoinCode}
          onBack={() => {
            clearJoinQueryFromUrl();
            navigateWithTransition('landing', () => setInitialJoinCode(''));
          }}
          onJoined={(session) => {
            try {
              sessionStorage.setItem('edurun_active_race_session', JSON.stringify(session));
            } catch {
              // ignore
            }
            navigateWithTransition('student_race', () => setStudentSession(session));
          }}
        />
      )}

      {route === 'student_race' && studentSession && (
        <StudentRaceView
          session={studentSession}
          onPlayAgain={() => {
            clearSavedRaceSession();
            navigateWithTransition('student_join', () => {
              setInitialJoinCode('');
              setStudentSession(null);
            });
          }}
          onReturnLobby={() => {
            clearSavedRaceSession();
            clearJoinQueryFromUrl();
            navigateWithTransition('landing', () => {
              setInitialJoinCode('');
              setStudentSession(null);
            });
          }}
        />
      )}

      {route === 'teacher_auth' && (
        <TeacherAuthView
          onBack={() => navigateWithTransition('landing')}
          onAuthenticated={(tok, prof) => {
            navigateWithTransition('teacher_dashboard', () => {
              setTeacherToken(tok);
              setTeacherProfile(prof);
            });
          }}
        />
      )}

      {route === 'teacher_dashboard' && teacherToken && teacherProfile && (
        <TeacherDashboard
          token={teacherToken}
          teacher={teacherProfile}
          onTeacherUpdated={(updated) => setTeacherProfile(updated)}
          onLogout={() => {
            clearDriveAccessToken();
            signOut(auth).catch(() => {});
            localStorage.removeItem('edurun_teacher_token');
            navigateWithTransition('landing', () => {
              setTeacherToken(null);
              setTeacherProfile(null);
            });
          }}
        />
      )}

      {showHowToPlay && <HowToPlayModal onClose={() => setShowHowToPlay(false)} />}

      {transitionOverlay?.visible && (
        <Loading3D
          variant="fullscreen"
          title={transitionOverlay.title}
          subtitle={transitionOverlay.subtitle}
          fadingOut={transitionOverlay.fadingOut}
        />
      )}
    </>
  );
}
