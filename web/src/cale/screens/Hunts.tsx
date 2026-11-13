// Collection › Chasses (maquette Chasses-style) : une chasse = un classeur qui traverse tous les sets
import { useEffect, useState } from 'react';
import { api, type Hunt, type HuntCriteria } from '../../api';
import { useApp } from '../../store';
import { th } from '../i18n/hunts';
import { Cover, Icon, Meter, Spinner } from '../kit';
import { CollectionHeader, eur0, huntKicker, huntName, huntTitle, pagesOf, sameCriteria, useNextMilestone } from './hunts/shared';
import './hunts.css';

// Chasses proposées en un geste quand elles ne sont pas déjà suivies
const IDEAS: HuntCriteria[] = [
  { rarity: 'SR', kind: 'alt', color: '' },
  { rarity: 'SEC', kind: '', color: '' },
  { rarity: '', kind: 'manga', color: '' },
  { rarity: '', kind: 'sp', color: '' },
  { rarity: 'L', kind: 'normal', color: '' },
  { rarity: 'L', kind: 'alt', color: '' },
];

export function Hunts() {
  const { version, toast } = useApp();
  const [hunts, setHunts] = useState<Hunt[] | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    let cancelled = false;
    api.hunts().then((h) => { if (!cancelled) setHunts(h); }).catch(() => {});
    return () => { cancelled = true; };
  }, [version]);

  const ideas = hunts ? IDEAS.filter((idea) => !hunts.some((h) => sameCriteria(h, idea))).slice(0, 5) : [];

  // Nombre de cartes de chaque idée
  useEffect(() => {
    let cancelled = false;
    ideas.forEach((idea, i) => {
      api.huntPreview(idea).then((p) => { if (!cancelled) setCounts((c) => ({ ...c, [i]: p.total })); }).catch(() => {});
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hunts]);

  const start = async (idea: HuntCriteria) => {
    try {
      const hunt = await api.createHunt(idea);
      window.location.hash = `collection/hunt/${hunt.id}`;
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <div className="hu-list">
      <CollectionHeader active="hunts" />
      <p className="dim hu-intro">{th('intro')}</p>
      {!hunts && <Spinner />}
      <div className="hu-tiles">
        {hunts?.map((h) => <HuntTile key={h.id} hunt={h} />)}
      </div>
      {hunts && (
        <section className="sec hu-ideas">
          {ideas.length > 0 && (
            <>
              <div className="sec-h"><h2 className="h">{th('ideas')}</h2></div>
              <div className="rows">
                {ideas.map((idea, i) => (
                  <button key={huntTitle(idea)} type="button" className="row hu-idea" onClick={() => start(idea)}>
                    <span className="row-main"><span className="row-t">{huntTitle(idea)}</span></span>
                    <span className="dim num hu-idea-n">{counts[i] ?? ''}</span>
                    <Icon name="plus" small />
                  </button>
                ))}
              </div>
            </>
          )}
          <a className="btn main hu-compose" href="#collection/hunt/new">{th('compose')}</a>
        </section>
      )}
    </div>
  );
}

function HuntTile({ hunt }: { hunt: Hunt }) {
  const { lang } = useApp();
  const next = useNextMilestone(hunt);
  const done = hunt.total > 0 && hunt.owned >= hunt.total;
  return (
    <a className="tile" href={`#collection/hunt/${hunt.id}`}>
      <span className="tile-top">
        <Cover cover={hunt.cover} lang={lang} className={done ? 'done' : undefined} />
        <span className="hu-info">
          <span className="over hu-kicker">{huntKicker(hunt)}</span>
          <span className="h">{huntName(hunt)}</span>
          <span className="dim hu-count">{th('count', { owned: hunt.owned, total: hunt.total, pages: pagesOf(hunt.total) })}</span>
        </span>
      </span>
      <span className="hu-ticks">
        <Meter ratio={hunt.owned / Math.max(1, hunt.total)} />
        <b style={{ left: '10%' }} /><b style={{ left: '25%' }} /><b style={{ left: '50%' }} />
      </span>
      <span className="hu-next">
        <span>
          {done ? th('complete') : next ? (
            <>
              <span className="dim">{th('palier', { pct: next.pct })}</span> {th('palier.cards', { n: next.n })}{next.eur != null && <> ≈ {eur0(next.eur)}</>}
            </>
          ) : <span className="dim">…</span>}
        </span>
        <Icon name="next" small className="dim" />
      </span>
    </a>
  );
}
