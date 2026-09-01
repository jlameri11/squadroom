/**
 * Am I running inside the native shell?
 *
 * Every adapter asks this and then branches once. Nothing above the adapters
 * is allowed to know — the moment a page checks the platform, the web and
 * native builds start to drift and the Capacitor phase stops being cheap.
 *
 * Deliberately does not import @capacitor/core at module scope. The web build
 * would then pull the whole runtime into the bundle for every parent on a
 * browser, to answer a question whose answer is always "no".
 */

export type NativePlatform = 'web' | 'ios' | 'android'

export function nativePlatform(): NativePlatform {
  if (typeof window === 'undefined') return 'web'
  const cap = (window as Window & { Capacitor?: { getPlatform?: () => string } }).Capacitor
  const platform = cap?.getPlatform?.()
  return platform === 'ios' || platform === 'android' ? platform : 'web'
}

export function isNative(): boolean {
  return nativePlatform() !== 'web'
}
