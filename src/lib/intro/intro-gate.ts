/** Session gating for the signature intro. */
const KEY = 'viv:intro:v1';

export function shouldPlayIntro(): boolean {
  try {
    return sessionStorage.getItem(KEY) === null;
  } catch {
    // Private-mode storage failures: play once per page lifetime instead.
    return !(window as Window & { __vivIntroSeen?: boolean }).__vivIntroSeen;
  }
}

export function markIntroSeen(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    (window as Window & { __vivIntroSeen?: boolean }).__vivIntroSeen = true;
  }
}

export function clearIntroSeen(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    (window as Window & { __vivIntroSeen?: boolean }).__vivIntroSeen = false;
  }
}
