// Image recognition: MindAR watches the camera until it sees the Ramen Builder
// card (target.png, compiled into targets.mind), then hands control to the game.
// Same pins and settings as sushi-ar: mind-ar 1.2.5 + three 0.160.0.

const params = new URLSearchParams(location.search);
export const TARGET_SRC = params.get('target') || './targets.mind';

let mindar = null;

export async function startScan(container, { onFound, onStatus }){
  onStatus('Loading the image tracker…');
  const { MindARThree } = await import('mindar-image-three');
  mindar = new MindARThree({
    container, imageTargetSrc: TARGET_SRC,
    uiScanning: 'no', uiLoading: 'no', uiError: 'no',
    filterMinCF: 0.001, filterBeta: 1000, warmupTolerance: 5, missTolerance: 10,
  });
  const anchor = mindar.addAnchor(0);
  let fired = false;
  anchor.onTargetFound = () => {
    if (fired) return;
    fired = true;
    onFound();
  };
  onStatus('Starting camera…');
  await mindar.start();
  const { renderer, scene, camera } = mindar;
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  onStatus('Looking for the card…');
}

export function stopScan(container){
  if (!mindar) return;
  try {
    mindar.renderer.setAnimationLoop(null);
    mindar.stop();
  } catch (e) { /* already stopped */ }
  mindar = null;
  container.querySelectorAll('video').forEach((v) => {
    v.srcObject?.getTracks?.().forEach((t) => t.stop());
  });
  container.innerHTML = '';
}
