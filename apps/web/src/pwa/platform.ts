/**
 * Pure platform checks for install UX. Kept separate from the store so the
 * rules can be unit-tested without a DOM.
 */
export interface PwaInstallPlatform {
  readonly displayModeStandalone: boolean;
  readonly navigatorStandalone: boolean;
}

export function isStandaloneMode(platform: PwaInstallPlatform): boolean {
  return platform.displayModeStandalone || platform.navigatorStandalone;
}

const IOS_DEVICE_PATTERN = /iPad|iPhone|iPod/;
// iPadOS 13+ reports a desktop "Macintosh" user agent; a touch screen is the
// only reliable way to tell it apart from a real Mac.
const MACINTOSH_PATTERN = /Macintosh/;
// Chrome, Firefox, Edge, Opera and Google's in-app browser on iOS are all
// WebKit underneath but none of them expose Safari's Add to Home Screen flow.
const IOS_ALTERNATIVE_BROWSER_PATTERN = /CriOS|FxiOS|EdgiOS|OPiOS|mercury|GSA/;

export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const isIosDevice =
    IOS_DEVICE_PATTERN.test(userAgent) || (MACINTOSH_PATTERN.test(userAgent) && maxTouchPoints > 1);
  return isIosDevice && !IOS_ALTERNATIVE_BROWSER_PATTERN.test(userAgent);
}
