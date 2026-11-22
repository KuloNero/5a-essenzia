// Versione dell'app. BUILD e BUILD_DATE vengono compilati dal workflow di pubblicazione (GitHub Pages).
export const APP_VERSION = '1.2.0';
export const BUILD = '__BUILD__';
export const BUILD_DATE = '__BUILD_DATE__';

export const isDevBuild = () => BUILD.startsWith('__');

export function versionLabel({ long = false } = {}) {
  const build = isDevBuild() ? 'sviluppo' : BUILD;
  if (!long) return `v${APP_VERSION} · ${build}`;
  const date = isDevBuild() || BUILD_DATE.startsWith('__') ? '' : ` del ${new Date(BUILD_DATE).toLocaleString('it-IT')}`;
  return `versione ${APP_VERSION} (build ${build}${date})`;
}
