// App branding — change these to rename the app everywhere
export const APP_NAME = 'El Sbobinator';
export const APP_SHORT = 'Sbobinatura';
export const APP_WINDOW_TITLE = 'El Sbobinator';
export const GITHUB_REPO = 'vimuw/El-Sbobinator';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases/latest`;
export const GITHUB_API_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
// Privacy notice of the web build, a static page of the same site (webBuild.ts emits it).
export const WEB_PRIVACY_PATH = '/privacy';
export const BUG_REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdzfLau1SrSZuJgQ2J3lERgtXcz9EjE_vP63nHkiVYCsRqMzA/viewform';

// Injected at build time by Vite from package.json — do not hardcode here.
declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v0.0.0';

// Web build without a release tag (a branch preview).
declare const __WEB_PREVIEW__: boolean;
export const WEB_PREVIEW_BUILD: boolean = typeof __WEB_PREVIEW__ !== 'undefined' && __WEB_PREVIEW__;

// Google Forms field for "Versione dell’app (facoltativa)".
export const BUG_REPORT_URL = `${BUG_REPORT_FORM_URL}?usp=pp_url&entry.1877160526=${encodeURIComponent(APP_VERSION)}`;
