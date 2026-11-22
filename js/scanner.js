// Lettura QR da fotocamera: BarcodeDetector nativo (Android/Chrome) con fallback jsQR (iOS/Safari, Firefox).
export async function startScanner(container, onResult, { onError } = {}) {
  container.innerHTML = `<div class="scanner"><video playsinline muted></video><div class="frame"></div><div class="hint">Inquadra il QR code</div></div>
    <div class="toolbar" style="justify-content:center;margin-top:.75rem"><button class="btn" data-torch hidden>🔦 Torcia</button><button class="btn" data-switch hidden>🔄 Cambia fotocamera</button></div>`;
  const video = container.querySelector('video');
  if (!navigator.mediaDevices?.getUserMedia) {
    onError?.(new Error('Fotocamera non disponibile: serve HTTPS e un browser che supporti la fotocamera'));
    return { stop() {} };
  }
  let stream = null, stopped = false, raf = 0, facing = 'environment';
  let detector = null;
  if ('BarcodeDetector' in window) {
    try { const f = await window.BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { /* */ }
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let last = '', lastAt = 0;

  async function open() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const torchBtn = container.querySelector('[data-torch]');
    if (caps.torch) {
      torchBtn.hidden = false;
      let on = false;
      torchBtn.onclick = () => { on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); };
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const sw = container.querySelector('[data-switch]');
    if (devices.length > 1) { sw.hidden = false; sw.onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; open().catch(e => onError?.(e)); }; }
  }

  async function tick() {
    if (stopped) return;
    if (video.readyState >= 2) {
      let text = null;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length) text = codes[0].rawValue;
        } else if (window.jsQR) {
          const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth));
          canvas.width = w; canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const r = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
          if (r) text = r.data;
        }
      } catch { /* frame non leggibile */ }
      if (text && (text !== last || Date.now() - lastAt > 2500)) {
        last = text; lastAt = Date.now();
        if (navigator.vibrate) navigator.vibrate(60);
        const keep = await onResult(text);
        if (!keep) { stop(); return; }
      }
    }
    raf = setTimeout(() => requestAnimationFrame(tick), detector ? 120 : 180);
  }

  function stop() {
    stopped = true;
    clearTimeout(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
  }

  try { await open(); tick(); }
  catch (e) {
    const msg = e.name === 'NotAllowedError' ? 'Permesso fotocamera negato: abilitarlo nelle impostazioni del browser' : `Impossibile avviare la fotocamera: ${e.message}`;
    onError?.(new Error(msg));
  }
  return { stop };
}
