/**
 * Puppuccino themes
 */

import { Style } from '@averagejoeslab/style';

/**
 * Theme color palette
 */
export interface ThemeColors {
  primary: [number, number, number];
  secondary: [number, number, number];
  accent: [number, number, number];
  text: [number, number, number];
  textDim: [number, number, number];
  background: [number, number, number];
  success: [number, number, number];
  error: [number, number, number];
  warning: [number, number, number];
  info: [number, number, number];
}

/**
 * Theme definition
 */
export interface Theme {
  name: string;
  colors: ThemeColors;
  styles: {
    heading: Style;
    text: Style;
    dim: Style;
    accent: Style;
    success: Style;
    error: Style;
    warning: Style;
    info: Style;
    code: Style;
    link: Style;
    prompt: Style;
    toolName: Style;
    toolOutput: Style;
  };
}

/**
 * Kaldi theme - warm, friendly colors inspired by a Great Pyrenees
 */
export const KaldiTheme: Theme = {
  name: 'kaldi',
  colors: {
    primary: [255, 250, 240], // Cream white (like Kaldi's fur)
    secondary: [139, 119, 101], // Light brown
    accent: [210, 180, 140], // Tan
    text: [245, 245, 245], // Off-white
    textDim: [169, 169, 169], // Gray
    background: [30, 30, 30], // Dark
    success: [144, 238, 144], // Light green
    error: [255, 99, 71], // Tomato red
    warning: [255, 215, 0], // Gold
    info: [135, 206, 235], // Sky blue
  },
  styles: {
    heading: new Style().foregroundRGB(255, 250, 240).bold(),
    text: new Style().foregroundRGB(245, 245, 245),
    dim: new Style().foregroundRGB(169, 169, 169),
    accent: new Style().foregroundRGB(210, 180, 140),
    success: new Style().foregroundRGB(144, 238, 144),
    error: new Style().foregroundRGB(255, 99, 71),
    warning: new Style().foregroundRGB(255, 215, 0),
    info: new Style().foregroundRGB(135, 206, 235),
    code: new Style().foregroundRGB(255, 250, 240).background(52),
    link: new Style().foregroundRGB(135, 206, 235).underline(),
    prompt: new Style().foregroundRGB(210, 180, 140).bold(),
    toolName: new Style().foregroundRGB(135, 206, 235).bold(),
    toolOutput: new Style().foregroundRGB(169, 169, 169),
  },
};

/**
 * Dark theme
 */
export const DarkTheme: Theme = {
  name: 'dark',
  colors: {
    primary: [97, 175, 239], // Blue
    secondary: [152, 195, 121], // Green
    accent: [229, 192, 123], // Yellow
    text: [220, 220, 220],
    textDim: [128, 128, 128],
    background: [30, 30, 30],
    success: [152, 195, 121],
    error: [224, 108, 117],
    warning: [229, 192, 123],
    info: [97, 175, 239],
  },
  styles: {
    heading: new Style().foregroundRGB(97, 175, 239).bold(),
    text: new Style().foregroundRGB(220, 220, 220),
    dim: new Style().foregroundRGB(128, 128, 128),
    accent: new Style().foregroundRGB(229, 192, 123),
    success: new Style().foregroundRGB(152, 195, 121),
    error: new Style().foregroundRGB(224, 108, 117),
    warning: new Style().foregroundRGB(229, 192, 123),
    info: new Style().foregroundRGB(97, 175, 239),
    code: new Style().foregroundRGB(220, 220, 220).background(236),
    link: new Style().foregroundRGB(97, 175, 239).underline(),
    prompt: new Style().foregroundRGB(152, 195, 121).bold(),
    toolName: new Style().foregroundRGB(97, 175, 239).bold(),
    toolOutput: new Style().foregroundRGB(128, 128, 128),
  },
};

/**
 * Light theme
 */
export const LightTheme: Theme = {
  name: 'light',
  colors: {
    primary: [0, 95, 184], // Blue
    secondary: [40, 167, 69], // Green
    accent: [202, 138, 4], // Amber
    text: [33, 33, 33],
    textDim: [117, 117, 117],
    background: [255, 255, 255],
    success: [40, 167, 69],
    error: [220, 53, 69],
    warning: [202, 138, 4],
    info: [0, 95, 184],
  },
  styles: {
    heading: new Style().foregroundRGB(0, 95, 184).bold(),
    text: new Style().foregroundRGB(33, 33, 33),
    dim: new Style().foregroundRGB(117, 117, 117),
    accent: new Style().foregroundRGB(202, 138, 4),
    success: new Style().foregroundRGB(40, 167, 69),
    error: new Style().foregroundRGB(220, 53, 69),
    warning: new Style().foregroundRGB(202, 138, 4),
    info: new Style().foregroundRGB(0, 95, 184),
    code: new Style().foregroundRGB(33, 33, 33).background(253),
    link: new Style().foregroundRGB(0, 95, 184).underline(),
    prompt: new Style().foregroundRGB(40, 167, 69).bold(),
    toolName: new Style().foregroundRGB(0, 95, 184).bold(),
    toolOutput: new Style().foregroundRGB(117, 117, 117),
  },
};

/**
 * Get theme by name
 */
export function getTheme(name: string): Theme {
  switch (name) {
    case 'kaldi':
      return KaldiTheme;
    case 'light':
      return LightTheme;
    case 'dark':
    default:
      return DarkTheme;
  }
}

/**
 * All available themes
 */
export const themes = {
  kaldi: KaldiTheme,
  dark: DarkTheme,
  light: LightTheme,
};
