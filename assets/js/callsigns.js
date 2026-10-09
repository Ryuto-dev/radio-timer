// コールサイン音源マニフェスト (assets/callsigns/*.wav)
// 再生指示はサーバー経由で全端末へ送られ、各端末はローカルトグルがONのときだけ鳴らす。
export const CALLSIGNS = [
  { id: 'ue', name: 'コールサイン上', file: 'assets/callsigns/ue.wav' },
  { id: 'shita', name: 'コールサイン下', file: 'assets/callsigns/shita.wav' },
];
export const CALLSIGN_IDS = new Set(CALLSIGNS.map((c) => c.id));
export function callsignById(id) {
  return CALLSIGNS.find((c) => c.id === id) || null;
}
// 即時再生用。Autoplay制限で弾かれたらfalseを返すのでUI側でタップ誘導すること
export async function playCallsignFile(file) {
  try {
    const a = new Audio(file);
    a.preload = 'auto';
    await a.play();
    return true;
  } catch {
    return false;
  }
}
export function preloadCallsings() {
  try {
    CALLSIGNS.forEach((c) => {
      const a = new Audio(c.file);
      a.preload = 'auto';
      a.load();
    });
  } catch {}
}
