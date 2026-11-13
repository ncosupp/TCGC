// Panneau d'administration (Réglages › Administration), réservé aux comptes admin : les chiffres du site, les comptes,
// la fiche d'un compte (Berry, boosters, mot de passe, suspension, suppression) et le journal des actions.
//   #admin               chiffres et liste des comptes
//   #admin/user/<id>     fiche d'un compte
//   #admin/log           journal des actions
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { formatDate } from '../../api';
import { locale } from '../../i18n';
import { useApp } from '../../store';
import { adminApi, opId, type AdminLogEntry, type AdminOverview, type AdminUser, type AdminUserRow, type UserFilter, type UserSort } from '../admin/api';
import { tr } from '../i18n/admin';
import { Caps, Glyph, Icon, Row, Rows, Sheet, Spinner, initials } from '../kit';
import { go } from '../routes';
import './admin.css';

// « 1 500 » (le français ne groupe pas les nombres à 4 chiffres par défaut, comme dans Réglages)
const num = (n: number) => new Intl.NumberFormat(locale(), { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions).format(n);
const signed = (n: number) => new Intl.NumberFormat(locale(), { signDisplay: 'exceptZero' }).format(n);

// « il y a 3 h », « hier »...
function ago(iso: string | null | undefined) {
  if (!iso) return '—';
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [86400 * 30, 'day'], [86400 * 365, 'month']];
  for (const [limit, unit] of steps) {
    if (Math.abs(s) < limit) {
      const div = { second: 1, minute: 60, hour: 3600, day: 86400, month: 86400 * 30 }[unit as 'second'];
      return rtf.format(Math.round(s / div), unit);
    }
  }
  return rtf.format(Math.round(s / (86400 * 365)), 'year');
}

const dateTime = (iso: string) => new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Topbar({ back }: { back: string }) {
  return (
    <div className="topbar">
      <button type="button" className="hit" onClick={() => go(back)} aria-label={tr('back')}><Icon name="back" /></button>
    </div>
  );
}

function Badges({ u }: { u: Pick<AdminUserRow, 'guest' | 'admin' | 'disabledAt'> }) {
  return (
    <>
      {u.admin && <span className="ad-badge gold">{tr('badge.admin')}</span>}
      {u.guest && <span className="ad-badge">{tr('guest')}</span>}
      {u.disabledAt && <span className="ad-badge down">{tr('badge.disabled')}</span>}
    </>
  );
}

// Ligne du journal : « +500 ฿ » / « 1 display OP03 offert »...
function actionText(e: AdminLogEntry) {
  const d = e.detail as Record<string, string | number>;
  switch (e.action) {
    case 'berry': return `${tr('act.berry', { amount: signed(Number(d.amount)) })}${d.note ? ` · « ${d.note} »` : ''}`;
    case 'boosters': {
      const what = `${d.count} ${d.kind === 'display' ? 'display' : 'booster'}${Number(d.count) > 1 ? 's' : ''} ${d.set}`;
      return `${tr('act.boosters', { what })}${d.note ? ` · « ${d.note} »` : ''}`;
    }
    case 'boosters-remove': return tr('act.boosters-remove', { n: Number(d.boosters), set: String(d.set) });
    case 'password': return tr(d.mode === 'mail' ? 'act.password.mail' : 'act.password.temp');
    case 'profile': return Array.isArray(e.detail.pseudo) ? `${tr('act.profile')} : ${(e.detail.pseudo as string[]).join(' → ')}` : tr('act.profile');
    case 'logout': case 'disable': case 'enable': case 'admin-grant': case 'admin-revoke': case 'delete':
      return tr(`act.${e.action}`);
    default: return e.action;
  }
}

function LogRows({ entries, withTarget }: { entries: AdminLogEntry[]; withTarget: boolean }) {
  return (
    <Rows className="ad-log">
      {entries.map((e) => (
        <Row key={e.id} chevron={withTarget && Boolean(e.live)}
          onClick={withTarget && e.live ? () => go(`admin/user/${e.targetId}`) : undefined}
          title={withTarget && e.target ? <><b>{e.target}</b> · {actionText(e)}</> : actionText(e)}
          meta={`${dateTime(e.at)} · ${tr('log.by', { who: e.adminId === 0 ? tr('act.cli') : e.admin })}`} />
      ))}
    </Rows>
  );
}

export function Admin({ parts }: { parts: string[] }) {
  const { user } = useApp();
  if (!user?.admin) {
    return (
      <div className="ad">
        <Topbar back="settings" />
        <section className="sec"><h1 className="title">{tr('title')}</h1><p className="ad-note">{tr('forbidden')}</p></section>
      </div>
    );
  }
  const id = Number(parts[1]);
  if (parts[0] === 'user' && id) return <UserScreen key={id} id={id} />;
  if (parts[0] === 'log') return <LogScreen />;
  return <HomeScreen />;
}

// ---------- Chiffres et liste ----------

function Stat({ label, value, meta }: { label: string; value: ReactNode; meta?: ReactNode }) {
  return (
    <div className="ad-stat">
      <span className="over">{label}</span>
      <span className="ad-stat-v num">{value}</span>
      {meta && <span className="ad-stat-m">{meta}</span>}
    </div>
  );
}

const FILTERS: UserFilter[] = ['members', 'guests', 'admins', 'disabled', 'all'];
const SORTS: UserSort[] = ['recent', 'seen', 'pseudo', 'berry', 'cards'];

// la recherche et les filtres sont gardés pendant la visite (retour depuis une fiche)
const listState = { q: '', filter: 'members' as UserFilter, sort: 'recent' as UserSort, page: 0 };

function HomeScreen() {
  const { toast } = useApp();
  const [stats, setStats] = useState<AdminOverview | null>(null);
  const [q, setQ] = useState(listState.q);
  const [filter, setFilter] = useState(listState.filter);
  const [sort, setSort] = useState(listState.sort);
  const [page, setPage] = useState(listState.page);
  const [list, setList] = useState<{ total: number; pageSize: number; users: AdminUserRow[] } | null>(null);

  useEffect(() => { adminApi.overview().then(setStats).catch((err) => toast((err as Error).message)); }, [toast]);

  useEffect(() => {
    Object.assign(listState, { q, filter, sort, page });
    let live = true;
    const timer = window.setTimeout(() => {
      adminApi.users({ q, filter, sort, page }).then((res) => { if (live) setList(res); }).catch((err) => toast((err as Error).message));
    }, q ? 250 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [q, filter, sort, page, toast]);

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div className="ad">
      <Topbar back="settings" />
      <section className="sec ad-head"><h1 className="title">{tr('title')}</h1></section>

      <section className="sec ad-sec">
        <p className="over">{tr('sec.site')}</p>
        {!stats ? <Spinner /> : (
          <>
            <div className="ad-stats">
              <Stat label={tr('st.members')} value={num(stats.members)} meta={tr('st.membersNew', { n: stats.newMembers7, m: stats.newMembers30 })} />
              <Stat label={tr('st.active')} value={num(stats.active7)} meta={tr('st.activeMeta', { n: stats.active1, m: stats.active7 })} />
              <Stat label={tr('st.games')} value={num(stats.games)} meta={tr('st.gamesMeta', { n: num(stats.games7), m: num(stats.online) })} />
              <Stat label={tr('st.berry')} value={`${num(stats.berry)} ฿`} />
              <Stat label={tr('st.boosters')} value={num(stats.boostersWaiting + stats.boostersOpened)} meta={tr('st.boostersMeta', { n: num(stats.boostersWaiting), m: num(stats.boostersOpened) })} />
              <Stat label={tr('st.copies')} value={num(stats.copies)} meta={tr('st.copiesMeta')} />
              <Stat label={tr('st.guests')} value={num(stats.guests)} meta={tr('st.guestsMeta', { n: stats.disabled })} />
            </div>
            {!stats.mail && <p className="ad-note">{tr('noMail')}</p>}
          </>
        )}
        <Rows className="ad-loglink">
          <Row lead={<Glyph icon="pulse" />} title={tr('logLink')} meta={tr('logLink.meta')} onClick={() => go('admin/log')} />
        </Rows>
      </section>

      <section className="sec ad-sec">
        <div className="sec-h"><p className="over">{tr('sec.users')}</p>{list && <span className="ad-count">{tr('count', { n: list.total })}</span>}</div>
        <label className="field ad-search">
          <Icon name="search" small />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={tr('search')} aria-label={tr('search')} />
        </label>
        <div className="chips ad-chips">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`chip${f === filter ? ' on' : ''}`} onClick={() => { setFilter(f); setPage(0); }}>{tr(`f.${f}`)}</button>
          ))}
        </div>
        <div className="ad-sort">
          <span className="dim">{tr('sort')}</span>
          <select value={sort} onChange={(e) => { setSort(e.target.value as UserSort); setPage(0); }} aria-label={tr('sort')}>
            {SORTS.map((s) => <option key={s} value={s}>{tr(`s.${s}`)}</option>)}
          </select>
        </div>
        {!list ? <Spinner /> : list.users.length === 0 ? <p className="ad-note">{tr('none')}</p> : (
          <Rows className="ad-users">
            {list.users.map((u) => (
              <Row key={u.id} onClick={() => go(`admin/user/${u.id}`)}
                lead={<span className="avatar">{u.guest ? '?' : initials(u.pseudo)}</span>}
                title={<>{u.pseudo} <Badges u={u} /></>}
                meta={[u.email || null, u.lastSeenAt ? tr('seen', { when: ago(u.lastSeenAt) }) : tr('never'),
                  `${num(u.balance)} ฿`, tr('cards', { n: u.copies })].filter(Boolean).join(' · ')} />
            ))}
          </Rows>
        )}
        {list && pages > 1 && (
          <div className="ad-pager">
            <button type="button" className="btn line" disabled={page === 0} onClick={() => setPage(page - 1)}>{tr('prev')}</button>
            <span className="dim">{tr('page', { n: page + 1, m: pages })}</span>
            <button type="button" className="btn line" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{tr('next')}</button>
          </div>
        )}
      </section>
      <div className="ad-end" />
    </div>
  );
}

// ---------- Journal ----------

function LogScreen() {
  const { toast } = useApp();
  const [entries, setEntries] = useState<AdminLogEntry[] | null>(null);
  const [next, setNext] = useState<number | undefined>();
  const load = useCallback((before?: number) => {
    adminApi.log(before).then((res) => {
      setEntries((prev) => (before && prev ? [...prev, ...res.entries] : res.entries));
      setNext(res.next);
    }).catch((err) => toast((err as Error).message));
  }, [toast]);
  useEffect(() => load(), [load]);
  return (
    <div className="ad">
      <Topbar back="admin" />
      <section className="sec ad-head"><h1 className="title">{tr('log.t')}</h1></section>
      <section className="sec ad-sec">
        {!entries ? <Spinner /> : entries.length === 0 ? <p className="ad-note">{tr('log.none')}</p> : <LogRows entries={entries} withTarget />}
        {next && <button type="button" className="btn line ad-more" onClick={() => load(next)}>{tr('log.more')}</button>}
      </section>
      <div className="ad-end" />
    </div>
  );
}

// ---------- Fiche d'un compte ----------

type Panel = 'berry-give' | 'berry-take' | 'boosters' | 'remove' | 'password' | 'edit' | 'logout' | 'disable' | 'enable' | 'grant' | 'revoke' | 'delete' | null;

function UserScreen({ id }: { id: number }) {
  const { user: me, toast } = useApp();
  const [u, setU] = useState<AdminUser | null>(null);
  const [stats, setStats] = useState<AdminOverview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  useEffect(() => {
    adminApi.user(id).then(setU).catch((err) => setFailed((err as Error).message));
    adminApi.overview().then(setStats).catch(() => {});
  }, [id]);

  const close = useCallback(() => setPanel(null), []);

  if (failed) return <div className="ad"><Topbar back="admin" /><section className="sec"><p className="ad-note">{failed}</p></section></div>;
  if (!u) return <div className="ad"><Topbar back="admin" /><Spinner /></div>;

  const self = u.id === me?.id;
  const who = u.pseudo;
  const kv: [string, ReactNode][] = [
    [tr('kv.id'), String(u.id)],
    [tr('kv.seen'), u.lastSeenAt ? ago(u.lastSeenAt) : '—'],
    [tr('kv.login'), u.lastLogin ? dateTime(u.lastLogin) : '—'],
    [tr('kv.sessions'), String(u.sessions)],
    [tr('kv.collection'), tr('kv.collectionV', { cards: num(u.collection.cards), copies: num(u.collection.copies) })],
    [tr('kv.wishes'), `${u.collection.wishes} · ${u.collection.hunts}`],
    [tr('kv.share'), `${tr(u.collection.shared ? 'yes' : 'no')} · ${tr(u.collection.trades ? 'yes' : 'no')}`],
    [tr('kv.devices'), String(u.collection.devices)],
    [tr('kv.games'), tr('kv.gamesV', { n: u.game.games, won: u.game.won, lost: u.game.lost })],
    [tr('kv.online'), String(u.game.online)],
    [tr('kv.decks'), String(u.game.decks)],
    [tr('kv.adventure'), tr('kv.adventureV', { n: u.game.chapters, m: num(u.game.hold) })],
  ];
  const waiting = u.boosters.filter((b) => b.waiting > 0);

  return (
    <div className="ad">
      <Topbar back="admin" />
      <section className="sec ad-head">
        <div className="ad-who">
          <span className="avatar">{u.guest ? '?' : initials(u.pseudo)}</span>
          <span className="ad-who-t">
            <span className="ad-name">{u.pseudo} <Badges u={u} /></span>
            <span className="ad-mail">{[u.email || null, tr('since', { date: formatDate(u.createdAt) })].filter(Boolean).join(' · ')}</span>
            {self && <span className="ad-mail gold">{tr('self')}</span>}
          </span>
        </div>
      </section>

      <section className="sec ad-sec">
        <p className="over">{tr('sec.berry')}</p>
        <div className="ad-wallet">
          <span className="display num">{num(u.balance)} <small>฿</small></span>
          <span className="sp" />
          <button type="button" className="btn main ad-small" onClick={() => setPanel('berry-give')}><Icon name="plus" small />{tr('give')}</button>
          <button type="button" className="btn line ad-small" onClick={() => setPanel('berry-take')} disabled={u.balance <= 0}><Icon name="minus" small />{tr('take')}</button>
        </div>
      </section>

      <section className="sec ad-sec">
        <p className="over">{tr('sec.boosters')}</p>
        {u.boosters.length === 0 ? <p className="ad-note">{tr('boosters.none')}</p> : (
          <dl className="kv">
            {u.boosters.map((b) => <KV key={b.set} term={b.set} value={tr('boosters.line', { n: b.waiting, m: b.opened })} />)}
          </dl>
        )}
        <div className="ad-actions">
          <button type="button" className="btn main ad-small" onClick={() => setPanel('boosters')} disabled={!stats}><Icon name="plus" small />{tr('boosters.give')}</button>
          {waiting.length > 0 && <button type="button" className="btn line ad-small" onClick={() => setPanel('remove')}>{tr('boosters.remove')}</button>}
        </div>
      </section>

      <section className="sec ad-sec">
        <p className="over">{tr('sec.account')}</p>
        <Rows>
          {!u.guest && <Row title={tr('a.edit')} onClick={() => setPanel('edit')} />}
          {!u.guest && <Row title={tr('a.password')} meta={tr('a.password.meta')} onClick={() => setPanel('password')} />}
          <Row title={tr('a.logout')} meta={tr('a.logout.meta', { n: u.sessions })} onClick={u.sessions ? () => setPanel('logout') : undefined} />
          {u.disabledAt
            ? <Row title={tr('a.enable')} meta={tr('a.enable.meta', { date: formatDate(u.disabledAt) })} onClick={() => setPanel('enable')} />
            : !self && !u.admin && <Row title={tr('a.disable')} meta={tr('a.disable.meta')} onClick={() => setPanel('disable')} />}
          {!u.guest && !u.disabledAt && !u.admin && <Row title={tr('a.grant')} meta={tr('a.grant.meta')} onClick={() => setPanel('grant')} />}
          {u.admin && !self && <Row title={tr('a.revoke')} onClick={() => setPanel('revoke')} />}
          {!self && !u.admin && <Row title={<span className="ad-danger">{tr('a.delete')}</span>} meta={tr('a.delete.meta')} onClick={() => setPanel('delete')} />}
        </Rows>
      </section>

      <section className="sec ad-sec">
        <p className="over">{tr('sec.summary')}</p>
        <dl className="kv">{kv.map(([k, v]) => <KV key={k} term={k} value={v} />)}</dl>
      </section>

      <section className="sec ad-sec">
        <p className="over">{tr('sec.ledger')}</p>
        {u.ledger.length === 0 ? <p className="ad-note">{tr('ledger.none')}</p> : (
          <Rows className="ad-log">
            {u.ledger.map((l) => (
              <Row key={l.id} title={l.label} meta={dateTime(l.at)}
                trail={<span className={`num ad-amount${l.amount > 0 ? ' up' : l.amount < 0 ? ' down' : ''}`}>
                  {l.amount ? `${signed(l.amount)} ฿` : l.boosters ? `+${l.boosters} boosters` : '0 ฿'}</span>} />
            ))}
          </Rows>
        )}
      </section>

      {u.log.length > 0 && (
        <section className="sec ad-sec">
          <p className="over">{tr('sec.log')}</p>
          <LogRows entries={u.log} withTarget={false} />
        </section>
      )}
      <div className="ad-end" />

      <BerrySheet u={u} mode={panel === 'berry-give' ? 'give' : panel === 'berry-take' ? 'take' : null} onClose={close} onDone={setU} />
      {stats && <BoosterSheet u={u} open={panel === 'boosters'} sets={stats.sets} onClose={close} onDone={setU} />}
      <RemoveSheet u={u} open={panel === 'remove'} onClose={close} onDone={setU} />
      <PasswordSheet u={u} open={panel === 'password'} mail={Boolean(stats?.mail)} onClose={close} onDone={() => adminApi.user(u.id).then(setU)} />
      <EditSheet u={u} open={panel === 'edit'} onClose={close} onDone={setU} />
      <Confirm open={panel === 'logout'} onClose={close} title={tr('logout.t', { who })} text={tr('logout.text')}
        run={async () => { const r = await adminApi.logout(u.id); toast(tr('logout.done', { n: r.sessions })); setU(await adminApi.user(u.id)); }} />
      <Confirm open={panel === 'disable'} onClose={close} title={tr('disable.t', { who })} text={tr('disable.text')} danger
        run={async () => { setU(await adminApi.disable(u.id, true)); toast(tr('disable.done')); }} />
      <Confirm open={panel === 'enable'} onClose={close} title={tr('enable.t', { who })} text={tr('enable.text')}
        run={async () => { setU(await adminApi.disable(u.id, false)); toast(tr('enable.done')); }} />
      <Confirm open={panel === 'grant'} onClose={close} title={tr('grant.t', { who })} text={tr('grant.text')}
        run={async () => { setU(await adminApi.setAdmin(u.id, true)); toast(tr('grant.done', { who })); }} />
      <Confirm open={panel === 'revoke'} onClose={close} title={tr('revoke.t', { who })} text={tr('revoke.text')}
        run={async () => { setU(await adminApi.setAdmin(u.id, false)); toast(tr('revoke.done', { who })); }} />
      <DeleteSheet u={u} open={panel === 'delete'} onClose={close} />
    </div>
  );
}

function KV({ term, value }: { term: string; value: ReactNode }) {
  return <><dt>{term}</dt><dd className="num">{value}</dd></>;
}

// Boutons Annuler / Valider d'un panneau
function Bar({ onClose, label, busy, disabled, danger }: { onClose: () => void; label: string; busy: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <div className="ad-bar">
      <button type="button" className="btn line" onClick={onClose}>{tr('cancel')}</button>
      <button type="submit" className={`btn ${danger ? 'c-danger' : 'main'}`} disabled={busy || disabled}>{busy ? '…' : label}</button>
    </div>
  );
}

// Envoi d'un formulaire de panneau : occupé, erreur affichée dans le panneau, fermeture si tout va bien
function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (run: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await run(); onClose(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return { busy, error, setError, submit };
}

function Confirm({ open, onClose, title, text, run, danger }: {
  open: boolean; onClose: () => void; title: string; text: string; run: () => Promise<void>; danger?: boolean;
}) {
  const { busy, error, submit } = useSubmit(onClose);
  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <form onSubmit={submit(run)}>
        <h2 className="ad-sheet-t">{title}</h2>
        <p className="ad-help">{text}</p>
        {error && <p className="ad-err" role="alert">{error}</p>}
        <Bar onClose={onClose} label={tr('confirm')} busy={busy} danger={danger} />
      </form>
    </Sheet>
  );
}

function BerrySheet({ u, mode, onClose, onDone }: { u: AdminUser; mode: 'give' | 'take' | null; onClose: () => void; onDone: (u: AdminUser) => void }) {
  const { toast } = useApp();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [op, setOp] = useState(opId);
  const { busy, error, setError, submit } = useSubmit(onClose);
  useEffect(() => { if (mode) { setAmount(''); setNote(''); setOp(opId()); setError(null); } }, [mode, setError]);
  const n = Math.floor(Number(amount));
  const ok = Number.isFinite(n) && n > 0 && (mode !== 'take' || n <= u.balance);
  const give = mode === 'give';
  return (
    <Sheet open={mode !== null} onClose={onClose} label={tr(give ? 'berry.giveT' : 'berry.takeT', { who: u.pseudo })}>
      <form onSubmit={submit(async () => {
        const next = await adminApi.berry(u.id, give ? n : -n, note, op);
        onDone(next);
        toast(tr('berry.done', { who: u.pseudo, n: signed(give ? n : -n) }));
      })}>
        <h2 className="ad-sheet-t">{tr(give ? 'berry.giveT' : 'berry.takeT', { who: u.pseudo })}</h2>
        <p className="ad-help">{tr('berry.balance', { n: num(u.balance) })}</p>
        <label className="field ad-field">
          <input type="number" inputMode="numeric" min={1} max={give ? 1_000_000 : u.balance} step={1} value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder={tr('berry.amount')} aria-label={tr('berry.amount')} autoFocus />
          <span className="dim">฿</span>
        </label>
        <div className="chips ad-chips">
          {(give ? [100, 500, 1000, 2000, 5000] : [100, 500, 1000, u.balance].filter((v, i, a) => v > 0 && v <= u.balance && a.indexOf(v) === i)).map((v) => (
            <button key={v} type="button" className={`chip${n === v ? ' on' : ''}`} onClick={() => setAmount(String(v))}>{num(v)}</button>
          ))}
        </div>
        <label className="field ad-field">
          <input type="text" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={tr(give ? 'berry.noteGive' : 'berry.noteTake')} aria-label={tr('berry.note')} />
        </label>
        <p className="ad-hint">{tr('berry.note')}</p>
        {error && <p className="ad-err" role="alert">{error}</p>}
        <Bar onClose={onClose} label={ok ? tr(give ? 'berry.goGive' : 'berry.goTake', { n: num(n) }) : tr('confirm')} busy={busy} disabled={!ok} danger={!give} />
      </form>
    </Sheet>
  );
}

function BoosterSheet({ u, open, sets, onClose, onDone }: {
  u: AdminUser; open: boolean; sets: AdminOverview['sets']; onClose: () => void; onDone: (u: AdminUser) => void;
}) {
  const { toast } = useApp();
  const [set, setSet] = useState(sets[0]?.set ?? '');
  const [kind, setKind] = useState<'booster' | 'display'>('booster');
  const [count, setCount] = useState('1');
  const [note, setNote] = useState('');
  const [op, setOp] = useState(opId);
  const { busy, error, setError, submit } = useSubmit(onClose);
  useEffect(() => { if (open) { setCount('1'); setNote(''); setOp(opId()); setError(null); } }, [open, setError]);
  const n = Math.floor(Number(count));
  const max = kind === 'display' ? 10 : 100;
  const ok = Boolean(set) && n >= 1 && n <= max;
  const per = sets.find((s) => s.set === set)?.boostersPerDisplay ?? 24;
  const quick = kind === 'display' ? [1, 2, 5] : [1, 5, 10, 24];
  const total = kind === 'display' ? n * per : n;
  return (
    <Sheet open={open} onClose={onClose} label={tr('bst.t', { who: u.pseudo })}>
      <form onSubmit={submit(async () => {
        onDone(await adminApi.boosters(u.id, set, kind, n, note, op));
        toast(tr('bst.done', { who: u.pseudo }));
      })}>
        <h2 className="ad-sheet-t">{tr('bst.t', { who: u.pseudo })}</h2>
        <div className="ad-line"><span className="dim">{tr('bst.set')}</span>
          <Caps label={tr('bst.set')} value={set} onChange={setSet} options={sets.map((s) => ({ value: s.set, label: s.set }))} /></div>
        <div className="ad-line"><span className="dim">{tr('bst.kind')}</span>
          <Caps label={tr('bst.kind')} value={kind} onChange={(k) => { setKind(k); setCount('1'); }}
            options={[{ value: 'booster', label: tr('bst.booster') }, { value: 'display', label: `${tr('bst.display')} (${per})` }]} /></div>
        <div className="ad-line"><span className="dim">{tr('bst.count')}</span>
          <div className="chips">
            {quick.map((v) => (
              <button key={v} type="button" className={`chip${n === v ? ' on' : ''}`} onClick={() => setCount(String(v))}>{v}</button>
            ))}
            <label className="field ad-count-in">
              <input type="number" inputMode="numeric" min={1} max={max} value={quick.includes(n) ? '' : count}
                onChange={(e) => setCount(e.target.value)} placeholder={tr('bst.other')} aria-label={tr('bst.count')} />
            </label>
          </div>
        </div>
        {ok && <p className="ad-help">{tr('bst.total', { n: total })}</p>}
        <label className="field ad-field">
          <input type="text" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('bst.note')} aria-label={tr('bst.note')} />
        </label>
        {error && <p className="ad-err" role="alert">{error}</p>}
        <Bar onClose={onClose} label={tr('bst.go')} busy={busy} disabled={!ok} />
      </form>
    </Sheet>
  );
}

function RemoveSheet({ u, open, onClose, onDone }: { u: AdminUser; open: boolean; onClose: () => void; onDone: (u: AdminUser) => void }) {
  const { toast } = useApp();
  const waiting = u.boosters.filter((b) => b.waiting > 0);
  const [set, setSet] = useState(waiting[0]?.set ?? '');
  const [count, setCount] = useState('1');
  const { busy, error, setError, submit } = useSubmit(onClose);
  useEffect(() => { if (open) { setSet((s) => (waiting.some((b) => b.set === s) ? s : waiting[0]?.set ?? '')); setCount('1'); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = waiting.find((b) => b.set === set)?.waiting ?? 0;
  const n = Math.floor(Number(count));
  const ok = n >= 1 && n <= max;
  return (
    <Sheet open={open} onClose={onClose} label={tr('rm.t')}>
      <form onSubmit={submit(async () => {
        const res = await adminApi.removeBoosters(u.id, set, n);
        onDone(res);
        toast(tr('rm.done', { n: res.removed }));
      })}>
        <h2 className="ad-sheet-t">{tr('rm.t')}</h2>
        <p className="ad-help">{tr('rm.text')}</p>
        <div className="ad-line"><span className="dim">{tr('bst.set')}</span>
          <Caps label={tr('bst.set')} value={set} onChange={setSet} options={waiting.map((b) => ({ value: b.set, label: `${b.set} (${b.waiting})` }))} /></div>
        <div className="ad-line"><span className="dim">{tr('bst.count')}</span>
          <div className="chips">
            {max > 1 && <button type="button" className={`chip${n === max ? ' on' : ''}`} onClick={() => setCount(String(max))}>{max}</button>}
            <label className="field ad-count-in">
              <input type="number" inputMode="numeric" min={1} max={max} value={count} onChange={(e) => setCount(e.target.value)} aria-label={tr('bst.count')} />
            </label>
          </div>
        </div>
        {error && <p className="ad-err" role="alert">{error}</p>}
        <Bar onClose={onClose} label={tr('rm.go', { n: ok ? n : '' })} busy={busy} disabled={!ok} danger />
      </form>
    </Sheet>
  );
}

function PasswordSheet({ u, open, mail, onClose, onDone }: { u: AdminUser; open: boolean; mail: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (open) { setPassword(null); setError(null); setCopied(false); } }, [open]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await action(); onDone(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!password) return;
    try { await navigator.clipboard.writeText(password); setCopied(true); } catch { /* sélection manuelle */ }
  };
  return (
    <Sheet open={open} onClose={onClose} label={tr('pw.t', { who: u.pseudo })}>
      <h2 className="ad-sheet-t">{tr('pw.t', { who: u.pseudo })}</h2>
      {password ? (
        <>
          <p className="ad-help">{tr('pw.shown')}</p>
          <div className="ad-secret">
            <code className="num">{password}</code>
            <button type="button" className="btn line ad-small" onClick={copy}><Icon name={copied ? 'check' : 'copy'} small />{tr(copied ? 'pw.copied' : 'pw.copy')}</button>
          </div>
          <p className="ad-help">{tr('pw.after', { who: u.pseudo })}</p>
          <div className="ad-bar"><button type="button" className="btn main" onClick={onClose}>OK</button></div>
        </>
      ) : (
        <>
          <p className="ad-help">{tr('pw.text')}</p>
          <Rows className="ad-choices">
            <Row title={tr('pw.temp')} meta={tr('pw.temp.meta')} onClick={busy ? undefined : () => run(async () => setPassword((await adminApi.tempPassword(u.id)).password))} />
            {mail
              ? <Row title={tr('pw.mail')} meta={tr('pw.mail.meta', { email: u.email })}
                  onClick={busy ? undefined : () => run(async () => { const r = await adminApi.mailReset(u.id); toast(tr('pw.sent', { email: r.email })); onClose(); })} />
              : <Row title={<span className="dim">{tr('pw.mail')}</span>} meta={tr('pw.mailOff')} />}
          </Rows>
          {busy && <Spinner />}
          {error && <p className="ad-err" role="alert">{error}</p>}
        </>
      )}
    </Sheet>
  );
}

function EditSheet({ u, open, onClose, onDone }: { u: AdminUser; open: boolean; onClose: () => void; onDone: (u: AdminUser) => void }) {
  const { toast } = useApp();
  const [pseudo, setPseudo] = useState(u.pseudo);
  const [email, setEmail] = useState(u.email);
  const { busy, error, setError, submit } = useSubmit(onClose);
  useEffect(() => { if (open) { setPseudo(u.pseudo); setEmail(u.email); setError(null); } }, [open, u.pseudo, u.email, setError]);
  const changed = pseudo.trim() !== u.pseudo || email.trim().toLowerCase() !== u.email;
  return (
    <Sheet open={open} onClose={onClose} label={tr('edit.t')}>
      <form onSubmit={submit(async () => {
        onDone(await adminApi.edit(u.id, { pseudo: pseudo.trim(), email: email.trim() }));
        toast(tr('edit.done'));
      })}>
        <h2 className="ad-sheet-t">{tr('edit.t')}</h2>
        <p className="ad-hint">{tr('edit.pseudo')}</p>
        <label className="field ad-field"><input type="text" value={pseudo} onChange={(e) => setPseudo(e.target.value)} aria-label={tr('edit.pseudo')} autoComplete="off" /></label>
        <p className="ad-hint">{tr('edit.email')}</p>
        <label className="field ad-field"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label={tr('edit.email')} autoComplete="off" /></label>
        {error && <p className="ad-err" role="alert">{error}</p>}
        <Bar onClose={onClose} label={tr('edit.go')} busy={busy} disabled={!changed} />
      </form>
    </Sheet>
  );
}

function DeleteSheet({ u, open, onClose }: { u: AdminUser; open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const [confirm, setConfirm] = useState('');
  const { busy, error, setError, submit } = useSubmit(onClose);
  useEffect(() => { if (open) { setConfirm(''); setError(null); } }, [open, setError]);
  return (
    <Sheet open={open} onClose={onClose} label={tr('del.t', { who: u.pseudo })}>
      <form onSubmit={submit(async () => {
        await adminApi.remove(u.id, confirm);
        toast(tr('del.done', { who: u.pseudo }));
        go('admin');
      })}>
        <h2 className="ad-sheet-t">{tr('del.t', { who: u.pseudo })}</h2>
        <p className="ad-help">{tr('del.text')}</p>
        <label className="field ad-field">
          <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={u.pseudo} aria-label={tr('del.t', { who: u.pseudo })} autoComplete="off" />
        </label>
        {error && <p className="ad-err" role="alert">{error}</p>}
        <Bar onClose={onClose} label={tr('del.go')} busy={busy} disabled={confirm !== u.pseudo} danger />
      </form>
    </Sheet>
  );
}
