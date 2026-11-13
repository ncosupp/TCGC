// Scanner (maquettes Scan-style, Scan-resultat-style, Scan-saisie-style, Scan-recap-style) : caméra, résultat,
// saisie par code et récap de la session. La caméra ne tourne que sur l'écran de visée, onglet actif.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, cardName, formatEur, type Card, type Lang, type ScanResult } from '../../api';
import { getUiLang } from '../../i18n';
import { useApp } from '../../store';
import { Icon, Slot, Spinner, cardTint } from '../kit';
import { tsc } from '../i18n/scan';
import { go } from '../routes';
import { Manual } from './scan/Manual';
import { Recap } from './scan/Recap';
import { Result } from './scan/Result';
import {
  CARD_RATIO, LOW_MARGIN, cameraSupported, defaultChoice, defaultManualChoice, langLabel, locate, readAuto, readSession, scanVersions,
  writeAuto, writeSession, type Candidate, type Location, type SessionEntry,
} from './scan/helpers';
import './scan.css';

type Phase = 'aim' | 'analyzing' | 'result';
type View = 'cam' | 'manual' | 'recap';

interface Stored { entry: SessionEntry; where: Location }

export function Scan({ active }: { active: boolean }) {
  // Langue des cartes scannées : la dernière choisie est retenue (voir store)
  const { cardChanged, toast, openCard, status, lang, setLang } = useApp();
  const ui = getUiLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTimer = useRef<number>(undefined);
  const [view, setView] = useState<View>(cameraSupported() ? 'cam' : 'manual');
  const [phase, setPhase] = useState<Phase>('aim');
  const [cameraError, setCameraError] = useState<string | null>(cameraSupported() ? null : 'insecure');
  const [torch, setTorch] = useState<boolean | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [fromManual, setFromManual] = useState(false);
  // Code tapé dans le panneau de résultat : ses cartes remplacent les propositions du scan
  const [searched, setSearched] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<SessionEntry[]>(() => readSession().added);
  const [auto, setAuto] = useState(readAuto);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Stored | null>(null);

  useEffect(() => { writeSession(added, null); }, [added]);

  const useCamera = !cameraError;
  // Sans caméra, la saisie par code est l'écran d'accueil du scanner
  const shown: View = useCamera || view === 'recap' ? view : 'manual';

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setTorch(null);
  }, []);

  // La caméra ne tourne que sur l'écran de visée, lorsque l'onglet est actif (aucune fiche carte ouverte)
  useEffect(() => {
    if (!active || shown !== 'cam' || !cameraSupported()) {
      stopCamera();
      return;
    }
    if (streamRef.current) return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) { video.srcObject = stream; video.play().catch(() => {}); }
      const caps = (stream.getVideoTracks()[0].getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch(caps.torch ? false : null);
      setCameraError(null);
    }).catch((err: Error) => {
      setCameraError(err.name === 'NotAllowedError' ? 'denied' : err.name === 'NotFoundError' ? 'none' : err.message);
    });
    return () => { cancelled = true; };
  }, [active, shown, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => () => window.clearTimeout(lastTimer.current), []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch { /* lampe indisponible */ }
  };

  const reset = () => {
    setPhase('aim');
    setResult(null);
    setError(null);
    setQuantity(1);
    setSearched(null);
  };

  // Rangement : l'exemplaire est ajouté, noté dans la session, et le toast dit où la carte est rangée
  const store = async (card: Card, qty: number) => {
    setBusy(true);
    try {
      const res = await api.add(card.id, qty, lang);
      cardChanged(res.card, res.totals);
      const entry: SessionEntry = { card: res.card, quantity: qty, lang, at: Date.now(), fresh: res.card.owned - qty <= 0, nth: res.card.owned };
      setAdded((list) => [entry, ...list]);
      const where = await locate(res.card);
      setLast({ entry, where });
      window.clearTimeout(lastTimer.current);
      lastTimer.current = window.setTimeout(() => setLast(null), 5000);
      return true;
    } catch (err) {
      toast((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const undo = async (entry: SessionEntry) => {
    try {
      const res = await api.add(entry.card.id, -entry.quantity, entry.lang);
      cardChanged(res.card, res.totals);
      setAdded((list) => list.filter((a) => a !== entry));
      setLast((l) => (l?.entry === entry ? null : l));
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const analyze = async (blob: Blob, mode: 'guide' | 'photo') => {
    setPhase('analyzing');
    setError(null);
    setQuantity(1);
    setFromManual(false);
    setSearched(null);
    try {
      const res = await api.scan(blob, mode);
      const choice = defaultChoice(res);
      const sure = res.candidates.length > 0 && res.margin >= LOW_MARGIN && scanVersions(res.candidates).length < 2;
      // Rangement auto : seule une carte certaine est rangée sans demander
      if (auto && sure) {
        reset();
        await store(res.candidates[choice].card, 1);
        return;
      }
      setResult(res);
      setSelected(choice);
      setPhase('result');
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
      setPhase('result');
    }
  };

  // Découpe l'image vidéo selon le cadre de visée affiché à l'écran
  const capture = () => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide || !video.videoWidth) return;
    const vb = video.getBoundingClientRect();
    const gb = guide.getBoundingClientRect();
    const scale = Math.max(vb.width / video.videoWidth, vb.height / video.videoHeight); // object-fit: cover
    const offX = (vb.width - video.videoWidth * scale) / 2;
    const offY = (vb.height - video.videoHeight * scale) / 2;
    const sx = (gb.left - vb.left - offX) / scale;
    const sy = (gb.top - vb.top - offY) / scale;
    const sw = gb.width / scale;
    const sh = gb.height / scale;
    const canvas = document.createElement('canvas');
    canvas.height = Math.min(900, Math.round(sh));
    canvas.width = Math.round(canvas.height * (sw / sh));
    canvas.getContext('2d')!.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob && analyze(blob, 'guide'), 'image/jpeg', 0.92);
  };

  // Photo prise avec l'appli appareil photo (ou choisie dans la galerie) : on la réduit avant l'envoi
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * ratio);
      canvas.height = Math.round(bitmap.height * ratio);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => blob && analyze(blob, 'photo'), 'image/jpeg', 0.92);
    } catch {
      analyze(file, 'photo');
    }
  };

  // Depuis la saisie : on choisit une carte, ses versions (même code) vont dans le panneau de résultat
  const choose = (cards: Card[], card: Card) => {
    const same = cards.filter((c) => c.number === card.number);
    setResult({ ms: 0, margin: 1, candidates: same.map((c) => ({ card: c, score: 0, sameArt: false })) });
    setSelected(Math.max(0, same.findIndex((c) => c.id === card.id)));
    setFromManual(true);
    setError(null);
    setQuantity(1);
    setPhase('result');
  };

  // Code tapé sous les propositions : les cartes trouvées deviennent les propositions, la plus courante est choisie
  const search = async (q: string): Promise<string | null> => {
    try {
      const { cards } = await api.cards({ q, limit: 40 });
      if (!cards.length) return tsc('man.none', { q });
      const found = cards.map((card) => ({ card, score: 0, sameArt: false }));
      setResult({ ms: 0, margin: 1, candidates: found });
      setSelected(defaultManualChoice(found));
      setSearched(q);
      setError(null);
      (document.activeElement as HTMLElement | null)?.blur(); // referme le clavier
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  };

  const changeAuto = () => { writeAuto(!auto); setAuto(!auto); };

  const candidates: Candidate[] = result?.candidates ?? [];
  const current = candidates[selected];
  // Versions à départager : celles du même code (saisie) ou du même visuel (scan), si la carte choisie en fait partie
  const pool = fromManual ? candidates
    : searched ? candidates.filter((c) => c.card.number === current?.card.number) : scanVersions(candidates);
  const versions = pool.some((c) => c.card.id === current?.card.id) ? pool : [];
  const unsure = !fromManual && !searched && (result?.margin ?? 1) < LOW_MARGIN && Boolean(current?.sameArt);
  const indexReady = (status?.scan.indexed ?? 0) > 0;
  const sessionCards = added.reduce((sum, a) => sum + a.quantity, 0);

  const finish = () => {
    setAdded([]);
    setView(cameraSupported() ? 'cam' : 'manual');
    go('home');
  };

  if (shown === 'recap') {
    return (
      <Recap entries={added} onClose={() => setView('cam')} onFinish={finish}
        onUndo={undo} onOpen={(e) => openCard(e.card.id, e.lang)} />
    );
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {shown === 'manual' && (
        <Manual lang={lang} setLang={setLang} onBack={useCamera ? () => { reset(); setView('cam'); } : undefined}
          onChoose={choose} onQuickAdd={(card) => store(card, 1)} onPhoto={() => fileRef.current?.click()} photoReady={indexReady}
          session={{ cards: sessionCards, open: () => setView('recap') }} />
      )}

      {shown === 'cam' && (
        <div className="sc-cam">
          <video ref={videoRef} className="sc-video" playsInline muted autoPlay />

          <div className="sc-top">
            <button type="button" className="glass" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
              aria-label={tsc('cam.langAria', { lang: langLabel(lang, ui) })}>
              {tsc('cam.langPill', { lang: langLabel(lang, ui) })}<Icon name="down" small />
            </button>
            <span className="sp" />
            <button type="button" className={auto ? 'glass on' : 'glass'} role="switch" aria-checked={auto} onClick={changeAuto}>{tsc('cam.auto')}</button>
            <button type="button" className={torch ? 'glass on sc-torch' : 'glass sc-torch'} onClick={toggleTorch}
              disabled={torch === null} aria-label={tsc('cam.torch')}><Icon name="bolt" small /></button>
          </div>

          <p className="sc-hint">{indexReady ? tsc('cam.hint') : tsc('cam.preparing', { indexed: status?.scan.indexed ?? 0, total: status?.scan.total ?? '…' })}</p>
          <div ref={guideRef} className="sc-frame" style={{ aspectRatio: String(CARD_RATIO) }} aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /><i className="d" /></div>

          <div className="sc-controls">
            {added.length > 0 ? (
              <button type="button" className="glass sc-session" onClick={() => setView('recap')} aria-label={tsc('cam.session', { n: sessionCards })}>
                <span className="sc-stack">
                  {added[1] && <Slot style={{ position: 'absolute', width: 20, left: 0, top: 1, transform: 'rotate(-8deg)' }}><span className="c-card" style={{ inset: 1, ...cardTint(added[1].card) }} /></Slot>}
                  <Slot style={{ position: 'absolute', width: 20, left: 3, top: 0 }}><span className="c-card" style={{ inset: 1, ...cardTint(added[0].card) }} /></Slot>
                </span>
                {sessionCards}
              </button>
            ) : <span />}
            <button type="button" className="sc-shutter" onClick={capture} disabled={!indexReady || phase !== 'aim'} aria-label={tsc('cam.shutter')}><span /></button>
            <button type="button" className="glass sc-code" onClick={() => setView('manual')}>{tsc('cam.code')}</button>
          </div>
        </div>
      )}

      {last && (
        <div className="cale sc-toastbox">
          <div className="toast" role="status">
            <Slot card={last.entry.card} lang={last.entry.lang} style={{ width: 30, flex: 'none' }} />
            <span className="sc-toasttext">
              <b>{last.entry.quantity > 1
                ? tsc('toast.storedMany', { n: last.entry.quantity, name: cardName(last.entry.card, last.entry.lang) })
                : tsc('toast.stored', { name: cardName(last.entry.card, last.entry.lang) })}</b>
              <span className="dim">{[
                last.where.setCode,
                last.where.page ? tsc('toast.page', { page: last.where.page }) : last.entry.card.variant ? tsc('toast.version', { version: last.entry.card.variant }) : null,
                tsc('toast.owned', { n: last.entry.card.ownedByLang[last.entry.lang] }),
              ].filter(Boolean).join(' · ')}</span>
            </span>
            <button type="button" onClick={() => undo(last.entry)}>{tsc('toast.undo')}</button>
          </div>
        </div>
      )}

      {phase === 'analyzing' && (
        <div className="cale sc-busy" role="status"><Spinner /><span>{tsc('cam.analyzing')}</span></div>
      )}

      {phase === 'result' && (
        <Result versions={versions} selected={current} manual={fromManual} auto={auto && shown === 'cam'}
          others={fromManual ? [] : candidates} searched={searched} unsure={unsure} onSearch={search}
          onSelect={(card) => setSelected(Math.max(0, candidates.findIndex((c) => c.card.id === card.id)))}
          lang={lang} setLang={setLang} quantity={quantity} setQuantity={setQuantity} error={error} busy={busy}
          onStore={async (card) => { if (await store(card, quantity)) reset(); }} onBack={reset} />
      )}
    </>
  );
}
