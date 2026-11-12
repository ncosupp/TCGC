// Textes d'un écran de la refonte : un petit dictionnaire FR / EN par écran (web/src/cale/i18n/<écran>.ts), même
// syntaxe que i18n.ts : texte ou paire [singulier, pluriel] selon `n`, variables {nom}. Les textes communs à toute
// l'appli restent dans i18n.ts (t()).
import { getUiLang } from '../../i18n';

type Entry = string | readonly [string, string];

export function makeT<K extends string>(fr: Record<K, Entry>, en: Record<K, Entry>) {
  return (key: K, vars: Record<string, string | number> = {}) => {
    const entry = (getUiLang() === 'en' ? en : fr)[key];
    const text = typeof entry === 'string' ? entry : Number(vars.n) === 1 || Number(vars.n) === 0 && getUiLang() === 'fr' ? entry[0] : entry[1];
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
  };
}
