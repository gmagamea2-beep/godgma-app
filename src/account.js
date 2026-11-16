// 계정 (Firebase: 구글 로그인 + Firestore 에 역할 저장)
//
// 역할
//   reader  독자  — 가입하면 누구나. 이름을 가린 공개본을 본다.
//   writer  작가  — 주인이 지정한다. 실명본을 보고 AI(Gemini)를 쓴다.
//   owner   주인  — 한 사람. 역할을 바꾸고 Gemini 키·실명 보기 코드를 설정한다.
//
// 권한은 화면이 아니라 Firestore 보안 규칙(firebase/firestore.rules)이 지킨다.
// 주인 이메일은 이 공개 코드에 쓰지 않는다. 규칙에는 이메일의 SHA-256 해시만 들어 있다.
//
// Firebase 웹 설정(apiKey 등)은 비밀이 아니다(웹 앱이면 누구나 볼 수 있는 값이고, 권한은 보안 규칙이 지킨다).
// src/firebase.config.json 에 두고, 빌드 환경 변수 VITE_FIREBASE_CONFIG(JSON)가 있으면 그것을 먼저 쓴다.
// 둘 다 없으면 계정 기능은 꺼지고 앱은 지금처럼 동작한다.

export const ROLES = Object.freeze({
  reader: '독자',
  writer: '작가',
  owner: '주인',
});
const RANK = { reader: 1, writer: 2, owner: 3 };
export const atLeast = (role, min) => (RANK[role] || 0) >= RANK[min];

import fileConfig from './firebase.config.json';

function readConfig() {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG;
  if (!raw) return fileConfig?.apiKey && fileConfig?.projectId ? fileConfig : null;
  try {
    const c = JSON.parse(raw);
    return c && c.apiKey && c.projectId ? c : null;
  } catch (e) {
    console.warn('[account] VITE_FIREBASE_CONFIG 형식이 잘못되었다', e);
    return null;
  }
}
const CONFIG = readConfig();
export const accountsEnabled = () => Boolean(CONFIG);

let fb = null; // { auth, db, mod }
async function load() {
  if (fb) return fb;
  if (!CONFIG) throw new Error('계정 기능이 설정되지 않았습니다.');
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore/lite'),
  ]);
  const app = initializeApp(CONFIG);
  const auth = authMod.getAuth(app);
  auth.languageCode = 'ko';
  fb = { auth, db: fsMod.getFirestore(app), A: authMod, F: fsMod };
  return fb;
}

/** 로그인 상태가 바뀔 때마다 cb({ user, profile }) 를 부른다. profile = { role, email, name } */
export async function watchAccount(cb) {
  const { auth, A } = await load();
  A.onAuthStateChanged(auth, async (user) => {
    if (!user) return cb({ user: null, profile: null });
    try {
      cb({ user, profile: await ensureProfile(user) });
    } catch (e) {
      console.error('[account] 프로필을 읽지 못했다', e);
      cb({ user, profile: null, error: e.message });
    }
  });
}

export async function signIn() {
  const { auth, A } = await load();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await A.signInWithPopup(auth, provider);
  } catch (e) {
    // 팝업이 막힌 환경(일부 홈 화면 앱)에서는 페이지 이동 방식으로 다시 시도한다
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
      await A.signInWithRedirect(auth, provider);
      return;
    }
    if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
    throw e;
  }
}

export async function signOut() {
  const { auth, A } = await load();
  await A.signOut(auth);
}

/** users/{uid} 문서를 읽고, 없으면 만든다. 주인 여부는 보안 규칙이 이메일 해시로 판단한다. */
async function ensureProfile(user) {
  const { db, F } = await load();
  const ref = F.doc(db, 'users', user.uid);
  const snap = await F.getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    // 주인 계정인데 독자로 만들어져 있었다면 주인으로 올린다 (규칙이 주인 이메일일 때만 허용)
    if (data.role !== 'owner') {
      try {
        await F.updateDoc(ref, { role: 'owner' });
        return { ...data, role: 'owner' };
      } catch {
        /* 주인이 아니면 규칙이 거절한다 */
      }
    }
    return data;
  }
  const base = { email: user.email || '', name: user.displayName || '', createdAt: Date.now() };
  // 주인 이메일이면 owner 로, 아니면 reader 로 만든다. 무엇이 될지는 규칙이 정한다.
  try {
    await F.setDoc(ref, { ...base, role: 'owner' });
    return { ...base, role: 'owner' };
  } catch {
    await F.setDoc(ref, { ...base, role: 'reader' });
    return { ...base, role: 'reader' };
  }
}

// ---------- 주인 전용 ----------

export async function listUsers() {
  const { db, F } = await load();
  const snap = await F.getDocs(F.collection(db, 'users'));
  return snap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (RANK[b.role] || 0) - (RANK[a.role] || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

export async function setRole(uid, role) {
  if (role !== 'reader' && role !== 'writer') throw new Error('바꿀 수 있는 역할은 독자·작가뿐입니다.');
  const { db, F } = await load();
  await F.updateDoc(F.doc(db, 'users', uid), { role });
}

// ---------- 비밀 설정 (작가 이상 읽기, 주인만 쓰기) ----------
// secrets/app = { geminiKey, geminiModel, shareCode }

export async function readSecrets() {
  const { db, F } = await load();
  const snap = await F.getDoc(F.doc(db, 'secrets', 'app'));
  return snap.exists() ? snap.data() : {};
}

export async function writeSecrets(patch) {
  const { db, F } = await load();
  await F.setDoc(F.doc(db, 'secrets', 'app'), patch, { merge: true });
}
