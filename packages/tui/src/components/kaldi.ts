/**
 * Kaldi the Great Pyrenees - Puppuccino's mascot
 */

import { Style } from '@averagejoeslab/style';

/**
 * Kaldi ASCII art variations
 */
export const KALDI = {
  normal: `
    / \\__
   (    @\\___
   /         O
  /   (_____/
 /_____/   U
`,

  thinking: `
    / \\__
   (    @\\___  ...
   /         O
  /   (_____/
 /_____/   U
`,

  happy: `
    / \\__
   (    @\\___  woof!
   /         O
  /   (_____/
 /_____/   U
`,

  working: `
    / \\__
   (    @\\___  *typing*
   /         O
  /   (_____/
 /_____/   U
`,

  error: `
    / \\__
   (    @\\___  :(
   /         O
  /   (_____/
 /_____/   U
`,

  small: `  /\\_/\\
 ( o.o )
  > ^ <`,
};

/**
 * Color schemes for Kaldi
 */
export const KALDI_COLORS = {
  body: [255, 250, 240] as [number, number, number], // Cream/white
  nose: [0, 0, 0] as [number, number, number], // Black
  accent: [139, 119, 101] as [number, number, number], // Light brown
};

/**
 * Get styled Kaldi art
 */
export function getKaldi(variant: keyof typeof KALDI = 'normal'): string {
  const art = KALDI[variant];
  const style = new Style()
    .foregroundRGB(...KALDI_COLORS.body)
    .bold();

  return style.render(art);
}

/**
 * Welcome banner with Kaldi
 */
export function getWelcomeBanner(version: string = '0.1.0'): string {
  const style = new Style().foregroundRGB(...KALDI_COLORS.body);
  const accentStyle = new Style().foregroundRGB(...KALDI_COLORS.accent);

  const banner = `
${style.render(KALDI.normal)}
${accentStyle.render('  ╔═══════════════════════════════════════╗')}
${accentStyle.render('  ║')}  ${style.render('Puppuccino')} ${accentStyle.render('- AI Coding Assistant')}    ${accentStyle.render('║')}
${accentStyle.render('  ║')}  ${style.render(`v${version}`)} ${accentStyle.render('| Powered by Kaldi')}        ${accentStyle.render('║')}
${accentStyle.render('  ╚═══════════════════════════════════════╝')}
`;

  return banner;
}

/**
 * Goodbye message with Kaldi
 */
export function getGoodbyeBanner(): string {
  const style = new Style().foregroundRGB(...KALDI_COLORS.body);

  return `
${style.render(KALDI.happy)}
  ${style.render('Goodbye! Kaldi will miss you!')}
`;
}

/**
 * Prompt prefix
 */
export function getPrompt(): string {
  return '\u{1F415}\u{200D}\u{1F9BA}\u276F '; // Dog emoji + prompt arrow
}
