// Éléments communs aux écrans Sets et Chasses : sous-navigation de la collection, titres et paliers d'une chasse
import { useEffect, useState } from 'react';
import { api, formatEur, type Hunt, type HuntCriteria } from '../../../api';
import { getUiLang, t, type MessageKey } from '../../../i18n';
import { th } from '../../i18n/hunts';
import { tsets } from '../../i18n/sets';
import { PageHeader } from '../../kit/PageHeader';

export function CollectionHeader({ active }: { active: 'sets' | 'hunts' | 'cards' }) {
  return (
    <PageHeader title={tsets('title')} tabsLabel={tsets('tabs.label')} tabs={[
      { href: '#collection', label: tsets('tabs.sets'), on: active === 'sets' },
      { href: '#collection/hunts', label: tsets('tabs.hunts'), on: active === 'hunts' },
      { href: '#collection/cards', label: tsets('tabs.cards'), on: active === 'cards' },
    ]} />
  );
}

// « 11 % » (FR, espace avant le signe) ou « 11% » (EN)
export const pctText = (ratio: number) => `${Math.round(ratio * 100)}${getUiLang() === 'en' ? '%' : ' %'}`;

// Les 9 points d'une mini-page : part de la progression
export function ratioDots(owned: number, total: number, atLeastOne = false): ('own' | 'miss')[] {
  let filled = Math.round((owned / Math.max(1, total)) * 9);
  if (atLeastOne && owned > 0) filled = Math.max(1, filled);
  return Array.from({ length: 9 }, (_, i) => (i < filled ? 'own' : 'miss'));
}

export const HUNT_PAGE_SIZE = 9;
export const pagesOf = (total: number) => Math.max(1, Math.ceil(total / HUNT_PAGE_SIZE));

export const sameCriteria = (a: HuntCriteria, b: HuntCriteria) => a.rarity === b.rarity && a.kind === b.kind && a.color === b.color;

// « Leader alt. », « SR (toutes versions) », « Manga · Rouge »
export function huntTitle({ rarity, kind, color }: HuntCriteria) {
  const k = kind || 'any';
  const r = rarity === 'L' ? t('set.rarity.leader') : rarity;
  const base = rarity ? t(`hunts.title.${k}` as MessageKey, { r }) : t(`hunts.title.${k}.none` as MessageKey);
  return color ? `${base} · ${t(`color.${color}` as MessageKey)}` : base;
}

// Nom court d'une chasse sans la mention « toutes versions » (qui passe en sur-titre) : « SR », « Leader alt. »
export function huntName(criteria: HuntCriteria) {
  if (criteria.rarity && !criteria.kind) {
    const base = criteria.rarity === 'L' ? t('set.rarity.leader') : criteria.rarity;
    return criteria.color ? `${base} · ${t(`color.${criteria.color}` as MessageKey)}` : base;
  }
  return huntTitle(criteria);
}

// « Leader · Alternatives », « Super rare · toutes versions »
export function huntKicker({ rarity, kind, color }: HuntCriteria) {
  const r = rarity ? th(`rarity.${rarity}` as Parameters<typeof th>[0]) : th('kicker.all');
  const k = kind ? t(`hunts.kind.${kind}` as MessageKey) : th('kicker.anyVersion');
  return [r, k, color ? t(`color.${color}` as MessageKey) : null].filter(Boolean).join(' · ');
}

export const MILESTONES = [10, 25, 50] as const;

export interface NextMilestone { pct: number; n: number; eur: number | null }

// Prochain palier (10, 25, 50 %, puis tout) : nombre de cartes à ranger et coût en prenant les moins chères
export function useNextMilestone(hunt: Hunt | null): NextMilestone | null | undefined {
  const [next, setNext] = useState<NextMilestone | null | undefined>(undefined);
  const id = hunt?.id;
  const owned = hunt?.owned;
  const total = hunt?.total;
  useEffect(() => {
    if (id == null || owned == null || total == null) return;
    const pct = [...MILESTONES, 100].find((p) => owned < Math.ceil((total * p) / 100));
    if (pct == null || owned >= total) { setNext(null); return; }
    const n = Math.ceil((total * pct) / 100) - owned;
    let cancelled = false;
    api.huntCards(id, { status: 'missing', sort: 'price-asc', limit: n, offset: 0 }).then(({ cards }) => {
      if (cancelled) return;
      const priced = cards.filter((c) => c.price.eur != null);
      setNext({ pct, n, eur: priced.length ? priced.reduce((s, c) => s + (c.price.eur ?? 0), 0) : null });
    }).catch(() => { if (!cancelled) setNext({ pct, n, eur: null }); });
    return () => { cancelled = true; };
  }, [id, owned, total]);
  return next;
}

export const eur0 = (v: number | null | undefined) => formatEur(v, true);
