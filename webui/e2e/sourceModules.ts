// Bundled only into the E2E build so page.evaluate can compute reference values
// with the same helpers the app ships, without a Vite dev server.
export * as formatting from '../src/utils';
export * as clipboard from '../src/editorClipboard';
export * as spacing from '../src/editorLineSpacing';
// Same module instance as the app's editor, so its history plugin honours it.
export { closeHistory } from '@tiptap/pm/history';
