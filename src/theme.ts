// The native chrome's colours, so the app around a page matches the theme inside it.
//
// The pages start dark and carry their own palette; these are the few colours the native header,
// scroll view, strip and footer need in order not to look detached from the page they frame.

import { Theme } from './lib/appState';

export type Palette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  rule: string;
  accent: string;
};

const DARK: Palette = {
  background: '#000000',
  surface: '#17191e',
  text: 'rgb(245, 245, 245)',
  muted: 'rgba(255, 255, 255, 0.57)',
  rule: 'rgba(250, 250, 250, 0.21)',
  accent: 'rgb(147, 151, 230)',
};

const LIGHT: Palette = {
  background: '#ffffff',
  surface: 'rgb(245, 245, 245)',
  text: 'rgb(18, 18, 18)',
  muted: 'rgba(5, 5, 5, 0.57)',
  rule: 'rgb(222, 222, 222)',
  accent: 'rgb(44, 50, 189)',
};

export function paletteFor(theme: Theme): Palette {
  return theme === 'dark' ? DARK : LIGHT;
}
