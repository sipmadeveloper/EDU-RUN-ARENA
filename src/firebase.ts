import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
] as const;

export const app = initializeApp(firebaseConfig);
const configuredDbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
export const db = configuredDbId ? getFirestore(app, configuredDbId) : getFirestore(app);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_WORKSPACE_SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({
  prompt: 'select_account',
  include_granted_scopes: 'true',
});

export const firebaseProjectInfo = {
  projectId: firebaseConfig.projectId,
  firestoreDatabaseId: configuredDbId || '(default)',
};

// ==================== IN-MEMORY GOOGLE WORKSPACE ACCESS TOKEN CACHE ====================
// Strictly stored in RAM only (never localStorage or sessionStorage), cleared on sign-out.
let cachedDriveAccessToken: string | null = null;
let isDriveSigningIn = false;
const driveTokenListeners = new Set<(token: string | null) => void>();

function notifyDriveTokenListeners() {
  for (const listener of driveTokenListeners) {
    try {
      listener(cachedDriveAccessToken);
    } catch {
      // ignore
    }
  }
}

onAuthStateChanged(auth, (user: User | null) => {
  if (!user && !isDriveSigningIn) {
    if (cachedDriveAccessToken !== null) {
      cachedDriveAccessToken = null;
      notifyDriveTokenListeners();
    }
  }
});

export function getDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export function setDriveAccessToken(token: string | null) {
  cachedDriveAccessToken = token && token.trim() ? token.trim() : null;
  notifyDriveTokenListeners();
}

export function clearDriveAccessToken() {
  cachedDriveAccessToken = null;
  notifyDriveTokenListeners();
}

export function subscribeDriveToken(listener: (token: string | null) => void): () => void {
  driveTokenListeners.add(listener);
  return () => {
    driveTokenListeners.delete(listener);
  };
}

/**
 * Signs in with Google (requesting Google Drive scope simultaneously) and caches
 * the OAuth access token strictly in memory so Google Drive is immediately connected.
 */
export async function signInWithGoogleAccount(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  isDriveSigningIn = true;
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken?.trim() || null;
    if (accessToken) {
      setDriveAccessToken(accessToken);
    }
    return { user: result.user, accessToken };
  } finally {
    isDriveSigningIn = false;
  }
}

export async function signInWithGoogleDrive(): Promise<{
  user: User;
  accessToken: string;
}> {
  const { user, accessToken } = await signInWithGoogleAccount();
  if (!accessToken) {
    throw new Error('Gagal mendapatkan izin akses Google Drive dari akun Google.');
  }
  return { user, accessToken };
}

// ==================== FIRESTORE ERROR HANDLING ====================

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatFriendlyFirestoreError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let msg = raw;
  try {
    const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
    if (parsed.error) msg = parsed.error;
  } catch {
    // not structured JSON
  }

  if (/Quota exceeded for quota metric 'Free daily read units/i.test(msg)) {
    const url = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseProjectInfo.firestoreDatabaseId}/data?openUpgradeDialog=true`;
    return `Kuota baca gratis harian Firebase Spark tercapai (reset besok). Info & upgrade: ${url}`;
  }
  if (/Quota exceeded|resource-exhausted/i.test(msg)) {
    return 'Kuota harian gratis Firebase Spark sedang penuh dan akan direset otomatis besok.';
  }
  if (/Missing or insufficient permissions|permission-denied/i.test(msg)) {
    return 'Akses Firestore ditolak. Pastikan Anda sudah masuk menggunakan akun Google terverifikasi.';
  }
  if (/the client is offline/i.test(msg)) {
    return 'Koneksi ke Firebase Firestore sedang offline. Periksa jaringan internet Anda.';
  }
  return msg;
}

let connectionTested = false;
export async function testConnection(): Promise<boolean> {
  if (connectionTested) return true;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    // Permission-denied on /test/connection still proves online reachability
    return true;
  }
}

testConnection().catch(() => {});
