/**
 * @puppuccino/tui - Terminal UI for Puppuccino
 *
 * A beautiful terminal interface for the Puppuccino AI coding agent,
 * built with @averagejoeslab packages.
 */

// Main application
export {
  type Model,
  type Msg,
  init,
  update,
  view,
  createApp,
} from './app.js';

// Themes
export {
  type Theme,
  type ThemeColors,
  KaldiTheme,
  DarkTheme,
  LightTheme,
  getTheme,
  themes,
} from './themes/index.js';

// Kaldi mascot
export {
  KALDI,
  KALDI_COLORS,
  getKaldi,
  getWelcomeBanner,
  getGoodbyeBanner,
  getPrompt,
} from './components/kaldi.js';

// Re-export useful types from dependencies
export { Program, Key, Cmd } from '@averagejoeslab/tui';
export { Style } from '@averagejoeslab/style';
export { render as renderMarkdown } from '@averagejoeslab/markdown';
