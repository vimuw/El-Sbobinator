// App branding — change these to rename the app everywhere
export const APP_NAME = 'El Sbobinator';
export const APP_SHORT = 'Sbobinatura';
export const APP_WINDOW_TITLE = 'El Sbobinator';
export const GITHUB_REPO = 'vimuw/El-Sbobinator';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
// Privacy notice of the web build, a static page of the same site (webBuild.ts emits it).
export const WEB_PRIVACY_PATH = '/privacy';
// The developer's contact, the same as on the privacy page: where reports go when the app cannot
// send them itself (builds without Sentry, a failed send).
export const SUPPORT_EMAIL = 'supporto@elsbobinator.com';

// Injected at build time by Vite from package.json — do not hardcode here.
declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v0.0.0';

// Web build without a release tag (a branch preview).
declare const __WEB_PREVIEW__: boolean;
export const WEB_PREVIEW_BUILD: boolean = typeof __WEB_PREVIEW__ !== 'undefined' && __WEB_PREVIEW__;

// An email to the developer with the app version in the subject.
export const BUG_REPORT_SUBJECT = `${APP_NAME} ${APP_VERSION}: segnalazione`;
export const BUG_REPORT_URL = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(BUG_REPORT_SUBJECT)}`;
