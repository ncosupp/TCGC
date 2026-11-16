// Étapes du parcours « Nouveau deck » (maquettes Nouveau-Deck et Editeur-deck) : quel deck (libre ou aventure), le
// Leader (grille de 3 colonnes ; en aventure, ceux absents de la Cale sont grisés), puis son nom. Le choix du Leader
// sert aussi à en changer depuis la table.
import { useMemo, useState } from 'react';
import { CARDS } from '../../../../game/engine/cards/index.ts';
import { DECK_SIZE } from '../../../../game/engine/deckRules.ts';
import type { Color } from '../../../../game/engine/types.ts';
import { deckTotal, leaderChoices, outOfHold, type DeckKind, type Hold } from '../../../../game/ui/builder/table.ts';
import { getUiLang } from '../../i18n';
import { tjd } from '../i18n/jeu-decks';
import { Icon, cx } from '../kit';
import { GameSlot } from './cards';
import type { Draft } from './useAutosave';
import './decks.css';

const COLORS: Color[] = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];
const COLOR_FR: Record<Color, string> = { Red: 'Rouge', Green: 'Vert', Blue: 'Bleu', Purple: 'Violet', Black: 'Noir', Yellow: 'Jaune' };
export const colorName = (c: Color) => (getUiLang() === 'en' ? c : COLOR_FR[c]);

function StepBar({ onBack, label, close, step }: { onBack: () => void; label: string; close?: boolean; step: string }) {
  return (
    <div className="topbar">
      <button type="button" className="hit" data-ui="steps.back" aria-label={label} onClick={onBack}><Icon name={close ? 'close' : 'back'} /></button>
      <span className="sp" />
      <span className="dim ds-step">{step}</span>
    </div>
  );
}

export function TypeStep({ hold, onPick, onCancel }: { hold: Hold | null; onPick: (kind: DeckKind) => void; onCancel: () => void }) {
  const cards = hold ? Object.values(hold).reduce((s, n) => s + n, 0) : 0;
  const kinds = hold ? Object.values(hold).filter((n) => n > 0).length : 0;
  return (
    <div className="cale jeu jx-screen ds" data-ui="decks.type">
      <StepBar onBack={onCancel} label={tjd('cancel')} close step={tjd('step', { n: 1 })} />
      <div className="ds-head"><h1 className="ds-title">{tjd('type.title')}</h1><p className="dim ds-hint">{tjd('type.hint')}</p></div>
      <div className="ds-types">
        <button type="button" className="ds-type" data-ui="decks.type-libre" onClick={() => onPick('libre')}>
          <span className="glyph"><Icon name="decks" /></span>
          <span className="ds-type-main">
            <span className="ds-type-t">{tjd('type.libre')}</span>
            <span className="dim">{tjd('type.libreText')}</span>
            <span className="dim ds-type-r"><Icon name="trophy" className="ic-xs" />{tjd('type.libreRanked')}</span>
          </span>
        </button>
        <button type="button" className="ds-type tb-sea" data-ui="decks.type-aventure" onClick={() => onPick('aventure')}>
          <span className="glyph sea"><Icon name="hold" /></span>
          <span className="ds-type-main">
            <span className="ds-type-t">{tjd('type.aventure')}</span>
            <span className="dim">{cards ? tjd('type.aventureText', { cards, kinds }) : tjd('type.aventureTextShort')}</span>
            <span className="sea ds-type-r"><Icon name="trophy" className="ic-xs" />{tjd('type.aventureRanked')}</span>
          </span>
        </button>
      </div>
      <p className="dim ds-next">{tjd('type.next')}</p>
    </div>
  );
}

export function LeaderStep({ kind, hold, current, changing, onPick, onBack }: {
  kind: DeckKind; hold: Hold | null; current?: string; changing?: boolean; onPick: (num: string) => void; onBack: () => void;
}) {
  const all = useMemo(() => leaderChoices(kind, hold), [kind, hold]);
  const [q, setQ] = useState('');
  const [color, setColor] = useState<Color | null>(null);
  const text = q.trim().toLowerCase();
  const list = all.filter(({ num }) => {
    const c = CARDS[num];
    if (color && !c.colors.includes(color)) return false;
    return !text || [c.name, num, ...c.typeLabels].some((x) => x.toLowerCase().includes(text));
  });
  const available = all.filter((l) => kind === 'libre' || l.inHold).length;
  return (
    <div className="cale jeu jx-screen ds" data-ui="leaders">
      <StepBar onBack={onBack} label={tjd('back')} step={changing ? tjd('leader.change') : tjd('step', { n: 2 })} />
      <div className="ds-head">
        <h1 className="ds-title">{tjd('leader.title')}</h1>
        <p className="dim ds-hint">{changing ? tjd('leader.hintChange') : kind === 'libre' ? tjd('leader.hintLibre') : tjd('leader.hintAventure')}</p>
      </div>
      <div className="ds-filters">
        <label className="field">
          <Icon name="search" small />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tjd('leader.search')} aria-label={tjd('leader.search')} data-ui="leaders.search" />
        </label>
        <div className="chips ds-colors" role="group" aria-label={tjd('leader.colors')}>
          <button type="button" className={cx('chip', !color && 'on')} aria-pressed={!color} onClick={() => setColor(null)}>{tjd('leader.allColors')}</button>
          {COLORS.map((c) => <button key={c} type="button" className={cx('chip', color === c && 'on')} aria-pressed={color === c} onClick={() => setColor(color === c ? null : c)}>{colorName(c)}</button>)}
        </div>
      </div>
      <div className="ds-leaders">
        {list.map(({ num, inHold }) => {
          const off = kind === 'aventure' && !inHold;
          const c = CARDS[num];
          return (
            <button key={num} type="button" className={cx('ds-leader', off && 'tb-off', current === num && 'tb-sel')} disabled={off} data-ui="leaders.item" onClick={() => onPick(num)}>
              <GameSlot num={num} virtual={inHold} />
              <span className="ds-leader-n">{c.name}</span>
              <span className="dim ds-leader-m">{off ? tjd('leader.notInHold') : `${c.colors.map(colorName).join('/')} · ${num}`}</span>
            </button>
          );
        })}
      </div>
      {!list.length && <p className="dim ds-empty">{available ? tjd('leader.none') : tjd('leader.noneHold')}</p>}
    </div>
  );
}

export function NameStep({ draft, kind, hold, rename, busy, onBack, onName, onSave }: {
  draft: Draft; kind: DeckKind; hold: Hold | null; rename: boolean; busy: boolean; onBack: () => void; onName: (name: string) => void; onSave: () => void;
}) {
  const total = deckTotal(draft.cards);
  const full = total >= DECK_SIZE;
  const out = outOfHold(draft.cards, hold) + ((hold?.[draft.leader] ?? 0) > 0 ? 0 : 1);
  const ranked = kind === 'aventure' || out === 0;
  const draftNote = !full && !rename;
  return (
    <div className="cale jeu jx-screen ds ds-name" data-ui="editor.name">
      <StepBar onBack={onBack} label={tjd('back')} step={rename ? tjd('menu.rename') : tjd('step', { n: 3 })} />
      <div className="ds-head"><h1 className="ds-title">{tjd('name.title')}</h1></div>
      <label className="ds-namefield">
        <span className="tb-sr">{tjd('name.field')}</span>
        <input value={draft.name} maxLength={40} autoFocus onChange={(e) => onName(e.target.value.replace(/\s*\n\s*/g, ' '))}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft.name.trim()) onSave(); }} />
      </label>
      <dl className="kv ds-kv">
        <dt>{tjd('name.leader')}</dt><dd>{CARDS[draft.leader]?.name}</dd>
        <dt>{tjd('name.cards')}</dt><dd className={full ? 'ds-ok' : undefined}>{total} / {DECK_SIZE} · {full ? tjd('table.ready') : tjd('table.left', { n: DECK_SIZE - total })}</dd>
        {hold && <><dt>{tjd('name.ranked')}</dt><dd className={ranked && full ? 'ds-ok' : undefined}>{ranked ? (full ? tjd('name.playable') : tjd('name.playableLater')) : tjd('name.out', { n: out })}</dd></>}
      </dl>
      {draftNote && <p className="dim ds-draft">{tjd('name.draft')}</p>}
      {!draft.name.trim() && <p className="ds-warn">{tjd('name.empty')}</p>}
      <div className="ds-save">
        <button type="button" className="btn main" disabled={!draft.name.trim() || busy} onClick={onSave} data-ui="editor.name-save">
          {rename ? tjd('name.ok') : full ? tjd('name.save') : tjd('name.saveDraft')}
        </button>
      </div>
    </div>
  );
}
