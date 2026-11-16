// Accueil de l'espace Jeu (#play ; maquettes Jeu-Accueil, -Nouveau, -Reprendre, -EN de Refonte-UI-jeu, étape 2).
// Dans l'ordre, chaque bloc masqué s'il est vide :
// 1. le bloc principal, une seule action selon le joueur : reprendre une partie interrompue, apprendre à jouer (tant
//    qu'aucune partie n'est terminée et que la partie guidée n'est ni faite ni écartée), sinon l'aventure ;
// 2. Jouer : les 3 modes en tuiles compactes ;
// 3. À récupérer : récompenses d'exploits et de missions, boosters à ouvrir, compte à créer pour un essai ;
// 4. Missions du jour, sur une ligne repliée qui mène au profil pirate.
// Rien ne se lance tout seul : une partie interrompue est proposée, et reprise seulement sur « Reprendre ».
import { useState } from 'react';
import { LEVELS, type Level } from '../../../../game/ai/search.ts';
import { replayRecord, type Replayed } from '../../../../game/coach/archive.ts';
import type { Progress } from '../../../../game/progress/catalog.ts';
import { isGuestAccount } from '../../../../game/ui/account.ts';
import type { HomeActions } from '../../../../game/ui/App.tsx';
import { loadRecord } from '../../../../game/ui/archiveClient.ts';
import { adventureProgress, type AdventureProgress } from '../../../../game/ui/home/adventureProgress.ts';
import { interruptedChapter, interruptedQuick, type HomeGame } from '../../../../game/ui/home/logic.ts';
import { useHome } from '../../../../game/ui/home/useHome.ts';
import { learnStatus, setLearnStatus } from '../../../../game/ui/learn/LessonBubble.tsx';
import { deckLabel, useMyDecks } from '../../../../game/ui/myDecks.ts';
import type { CurrentMatch } from '../../../../game/ui/online/api.ts';
import { useProgress } from '../../../../game/ui/progress/store.ts';
import { navigate, type Route } from '../../../../game/ui/routes.ts';
import { tjh } from '../i18n/jeu-home';
import { Icon, Row, Rows, Spinner, type CaleIconName } from '../kit';
import { JeuScreen, JeuTopBar, Prime, ago, berryText } from './parts';
import './home.css';

export interface JeuHomeProps extends HomeActions { notice?: string }

const levelName = (level: number) => LEVELS[level as Level]?.name ?? String(level);

interface Hero {
  kind: string;
  over: string;
  title: string;
  msg?: string;
  main: { label: string; run: () => void | Promise<void>; ui: string };
  second?: { label: string; run: () => void; ui: string; aria?: string };
  ladder?: { won: number; total: number; now: number };
  error?: string;
}

export function JeuHome({ notice, resume, learn, help, settings }: JeuHomeProps) {
  useMyDecks();   // noms de mes decks (parties interrompues avec un deck perso)
  const data = useHome();
  const { progress } = useProgress();
  const [learnShown, setLearnShown] = useState(() => learnStatus() === 'new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const now = Date.now();
  const games = data.games ?? [];
  const quick = interruptedQuick(games, now, data.dismissed);
  const chapter = data.adventure ? interruptedChapter(games, data.adventure.deckId, now, data.dismissed) : undefined;
  const adv = data.adventure ? adventureProgress(data.adventure) : null;
  // « Nouveau au jeu ? » disparaît après la première partie terminée (audit 02d)
  const finished = games.some((g) => g.status === 'won' || g.status === 'lost');
  const isNew = learnShown && !finished;

  const resumeQuick = async (game: HomeGame) => {
    setBusy(true);
    setError(undefined);
    try {
      const rec = await loadRecord(game.id);
      let replayed: Replayed;
      try {
        replayed = replayRecord(rec);
      } catch {
        throw new Error(tjh('resume.error'));
      }
      resume(rec, replayed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const hero: Hero = data.online ? onlineHero(data.online)
    : quick ? {
      kind: 'resume', over: tjh('resume.over'),
      title: tjh('resume.vs', { me: deckLabel(quick.config.myDeck, quick.config.myDeckName), them: deckLabel(quick.config.aiDeck, quick.config.aiDeckName) }),
      msg: tjh('resume.quickMsg', { level: levelName(quick.config.level), turn: quick.turns, since: ago(quick.updatedAt, now) }),
      main: { label: tjh('resume.main'), run: () => resumeQuick(quick), ui: 'home.resume-go' },
      second: { label: tjh('resume.second'), run: () => data.dismiss(quick.id), ui: 'home.resume-dismiss', aria: tjh('resume.secondLabel') },
      error,
    }
    : chapter ? {
      kind: 'resume', over: tjh('resume.chapterOver'),
      title: tjh('resume.chapterTitle', { place: chapter.chapter.place, name: chapter.chapter.opponent.name }),
      msg: tjh('resume.chapterMsg', { turn: chapter.game.turns, since: ago(chapter.game.updatedAt, now) }),
      main: { label: tjh('resume.main'), run: () => navigate({ name: 'aventure', screen: { kind: 'chapter', id: chapter.chapter.id } }), ui: 'home.chapter-resume' },
      second: { label: tjh('resume.second'), run: () => data.dismiss(chapter.game.id), ui: 'home.chapter-dismiss', aria: tjh('resume.secondLabel') },
    }
    : isNew ? {
      kind: 'new', over: tjh('new.over'), title: tjh('new.title'), msg: tjh('new.msg'),
      main: { label: tjh('new.main'), run: learn, ui: 'home.learn' },
      second: { label: tjh('new.second'), run: () => { setLearnStatus('dismissed'); setLearnShown(false); }, ui: 'home.learn-skip' },
    }
    : adventureHero(adv);
  // l'aventure en rappel quand l'action principale est ailleurs (partie à reprendre)
  const advRow = hero.kind === 'resume' || hero.kind === 'online' ? adv : null;

  return (
    <JeuScreen className="jh" data-ui={data.ready ? 'home' : 'home.loading'}>
      <JeuTopBar />
      {notice && <p className="jh-notice dim">{notice}</p>}
      {!data.ready ? <div className="jh-wait" aria-label={tjh('loading')}><Spinner /></div> : <>
        <section className="hero" aria-labelledby="jh-hero-title" data-ui={`home.hero-${hero.kind}`}>
          <p className="over">{hero.over}</p>
          <h1 id="jh-hero-title" className="title jh-hero-title">{hero.title}</h1>
          {hero.msg && <p className="dim jh-hero-msg">{hero.msg}</p>}
          {hero.ladder && (
            <div className="jh-ladder" role="img" aria-label={tjh('adv.ladder', { n: hero.ladder.won, won: hero.ladder.won, total: hero.ladder.total })}>
              <span className="ladder">{Array.from({ length: hero.ladder.total }, (_, i) => <i key={i} className={i < hero.ladder!.won ? 'on' : i === hero.ladder!.now ? 'now' : undefined} />)}</span>
              <span className="num dim">{Math.min(hero.ladder.now + 1, hero.ladder.total)} / {hero.ladder.total}</span>
            </div>
          )}
          {hero.error && <p className="jh-error" role="alert">{hero.error}</p>}
          <div className="jh-hero-actions">
            <button type="button" className="btn main" data-ui={hero.main.ui} disabled={busy} onClick={() => void hero.main.run()}>{hero.main.label}</button>
            {hero.second && <button type="button" className="btn quiet" data-ui={hero.second.ui} title={hero.second.aria} onClick={hero.second.run}>{hero.second.label}</button>}
          </div>
        </section>

        {advRow && advRow.started && advRow.next && (
          <div className="jh-advrow">
            <Row onClick={() => navigate({ name: 'aventure' })} lead={<span className="glyph sea"><Icon name="map" /></span>}
              title={tjh('adv.row', { n: advRow.nextNumber ?? 1 })}
              meta={tjh('adv.rowMeta', { place: advRow.next.place, won: advRow.won, total: advRow.total })} />
          </div>
        )}

        <section className="sec jh-sec" aria-labelledby="jh-play">
          <div className="sec-h"><h2 id="jh-play" className="h">{tjh('play')}</h2></div>
          <div className="modes">
            <Mode icon="globe" title={tjh('m1')} sub={tjh('m1s')} route={{ name: 'chercher' }} ui="home.queue" />
            <Mode icon="bolt" title={tjh('m2')} sub={tjh('m2s')} route={{ name: 'rapide' }} ui="home.quick" />
            <Mode icon="friend" title={tjh('m3')} sub={tjh('m3s')} route={{ name: 'ami' }} ui="home.online" />
          </div>
        </section>

        <section className="sec jh-sec jh-rows">
          <Rows>
            <ToCollect progress={progress} adventure={adv} guest={isGuestAccount() && (finished || (progress?.bounty.amount ?? 0) > 0)} />
            {progress && <Missions progress={progress} />}
          </Rows>
        </section>

        <nav className="jh-more" aria-label={tjh('more.history')}>
          <button type="button" className="link" data-ui="home.history" onClick={() => navigate({ name: 'parties' })}><Icon name="history" small />{tjh('more.history')}</button>
          <button type="button" className="link" data-ui="home.help" onClick={help}><Icon name="help" small />{tjh('more.help')}</button>
          <button type="button" className="link" data-ui="home.settings" onClick={settings}><Icon name="settings" small />{tjh('more.settings')}</button>
          <a className="link" href="#legal">{tjh('more.about')}</a>
        </nav>
      </>}
    </JeuScreen>
  );
}

function onlineHero(match: CurrentMatch): Hero {
  const playing = match.status === 'playing';
  return {
    kind: 'online',
    over: tjh('online.over'),
    title: playing ? tjh('online.title', { name: match.opponent ?? tjh('online.friend') }) : tjh('online.waitTitle', { code: match.code ?? '' }),
    msg: playing ? tjh('online.msg') : tjh('online.waitMsg'),
    main: { label: playing ? tjh('resume.main') : tjh('online.open'), run: () => navigate({ name: 'partie', id: match.id }), ui: 'home.online-resume' },
  };
}

function adventureHero(p: AdventureProgress | null): Hero {
  const map = { label: tjh('adv.map'), run: () => navigate({ name: 'aventure' }), ui: 'home.adventure-map' };
  if (!p || !p.started) {
    return { kind: 'adventure', over: tjh('adv.overStart'), title: tjh('adv.startTitle'), msg: tjh('adv.startMsg'),
      main: { label: tjh('adv.startMain'), run: () => navigate({ name: 'aventure' }), ui: 'home.adventure' } };
  }
  if (p.finished || !p.next) {
    return { kind: 'adventure', over: tjh('adv.over', { arc: p.arc.title }), title: tjh('adv.doneTitle', { arc: p.arc.title }),
      msg: p.challengesLeft ? tjh('adv.doneMsg', { n: p.challengesLeft }) : tjh('adv.doneAll'),
      main: { label: tjh('adv.doneMain'), run: () => navigate({ name: 'aventure' }), ui: 'home.adventure' },
      ladder: { won: p.won, total: p.total, now: p.total } };
  }
  const next = p.next;
  return {
    kind: 'adventure', over: tjh('adv.over', { arc: p.arc.title }),
    title: tjh('adv.title', { n: p.nextNumber ?? 1, place: next.place }),
    msg: tjh('adv.msg', { title: next.title, name: next.opponent.name }),
    main: { label: tjh('adv.main'), run: () => navigate({ name: 'aventure', screen: { kind: 'chapter', id: next.id } }), ui: 'home.adventure' },
    second: map,
    ladder: { won: p.won, total: p.total, now: (p.nextNumber ?? 1) - 1 },
  };
}

function Mode({ icon, title, sub, route, ui }: { icon: CaleIconName; title: string; sub: string; route: Route; ui: string }) {
  return (
    <button type="button" className="mode" data-ui={ui} onClick={() => navigate(route)}>
      <Icon name={icon} />
      <span><b>{title}</b><br /><small>{sub}</small></span>
    </button>
  );
}

// Récompenses à récupérer (dans le profil pirate), boosters à ouvrir (dans la Cale), compte à créer : seulement s'il y a
// quelque chose
function ToCollect({ progress, adventure, guest }: { progress: Progress | null; adventure: AdventureProgress | null; guest: boolean }) {
  const claim = progress?.toClaim ?? 0;
  const exploits = progress ? progress.exploits.filter((e) => e.done && !e.claimed) : [];
  const missions = progress ? [...progress.missions.items, progress.missions.weekly].filter((m) => m.done && !m.claimed) : [];
  const berry = exploits.reduce((s, e) => s + e.berry, 0) + missions.reduce((s, m) => s + m.berry, 0);
  const boosterSets = exploits.flatMap((e) => (e.boosters ? [`${e.boosters.count} booster${e.boosters.count > 1 ? 's' : ''} ${e.boosters.set}`] : []));
  const boosters = adventure?.boosters ?? 0;
  return (
    <>
      {claim > 0 && (
        <Row onClick={() => navigate({ name: 'profil' })} chevron={false} lead={<span className="glyph sea"><Icon name="gift" /></span>}
          title={exploits.length && !missions.length ? tjh('claimExploit', { n: exploits.length }) : tjh('claim', { n: claim })}
          meta={[berry ? berryText(berry) : null, ...boosterSets].filter(Boolean).join(' + ') || undefined}
          trail={<span className="jh-go sea">{tjh('claimGo')}</span>} />
      )}
      {boosters > 0 && (
        <Row onClick={() => navigate({ name: 'aventure', screen: { kind: 'hold' } })} chevron={false} lead={<span className="glyph sea"><Icon name="hold" /></span>}
          title={tjh('boosters', { n: boosters })} meta={tjh('boostersMeta')} trail={<span className="jh-go sea">{tjh('boostersGo')}</span>} />
      )}
      {guest && (
        <Row href="#creer-compte" chevron={false} lead={<span className="glyph"><Icon name="pirate" /></span>}
          title={tjh('guest')} meta={tjh('guestMeta')} trail={<span className="jh-go sea">{tjh('guestGo')}</span>} />
      )}
    </>
  );
}

// Missions du jour, repliées : « 1 / 3 · 25 ฿ à prendre », la prime à droite ; le détail est dans le profil pirate
function Missions({ progress }: { progress: Progress }) {
  const items = progress.missions.items;
  const done = items.filter((m) => m.done).length;
  const left = items.filter((m) => !m.done).reduce((s, m) => s + m.berry, 0);
  return (
    <Row onClick={() => navigate({ name: 'profil' })} lead={<span className="glyph"><Icon name="target" /></span>}
      title={tjh('mis')}
      meta={left ? tjh('misMeta', { done, total: items.length, berry: berryText(left) }) : tjh('misMetaDone', { done, total: items.length })}
      trail={<Prime amount={progress.bounty.amount} />} />
  );
}
