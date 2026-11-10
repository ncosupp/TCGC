// CARTES D'OP09 CODÉES À LA MAIN (étape C, tâche S10) : celles que le traducteur ne comprend pas ou que le format des
// recettes ne sait pas dire (remplacements, règles d'un Leader, « cette carte » après un choix, total de puissance...).
// Codées d'après leur texte officiel VO (et la VF quand elle existe), avec les briques existantes ; les choix
// d'interprétation sont dans game/docs/interpretations.md (section « OP09, PRB01, ST15 à ST20 (tâche S10) », 2900 à
// 2999). Aucun texte de carte ici.
import {
  addDonFromDeck, addMod, canBeKO, canLeaveByEffect, chooseUpTo1, def, describe, fieldCost, findField, log, may, other, power, removeByEffect, setActive,
  untilOpponentsNextEnd,
} from '../rules.ts';
import type { CardBehavior, EffectCtx, FieldCard, GameState, Keyword, PlayerId } from '../types.ts';
import {
  all, bothCosts, candidates, card, chooseOne, discard, discardCost, drawCards, effect, grant, handToBottom,
  leaderType, oppChar, oppDiscards, oppLeader, oppLeaderOrChar, playFromHand, restDon, restSelf, seq,
  when, withCost, type Cost, type Effect, type Targets,
} from './bricks.ts';
import { addDonUpTo, askDonCount } from './bricks-don.ts';
import { playFromHandAtCost } from './bricks-play.ts';
import { trashByEffect } from './bricks-removal.ts';

const BB = 'Blackbeard Pirates';        // {Équipage de Barbe Noire}
const CG = 'Cross Guild';

// « mis KO par un effet » (et non en combat) : le combat cherche son remplacement à l'étape des dégâts, sur la carte
// attaquée (engine.ts) ; un effet ne vise jamais cette carte à cette étape
export const koByEffect = (s: GameState, victim: FieldCard) => !(s.battle?.step === 'damage' && s.battle.target === victim.uid);

// Annule les effets de la carte choisie (rien sans choix) ; la suite reçoit la carte
const negateChosen = (t: Targets, u: 'turn' | 'oppNextEnd', source: string, text: string, after?: (ctx: EffectCtx, uid: number) => void): Effect => ({
  run: (ctx) => {
    const uid = chooseUpTo1(ctx, candidates(ctx.s, ctx.me, t, undefined, ctx.source), `${source} : ${t.label} ${text} :`, 'oppLock');
    if (uid === null) return;
    const until = u === 'oppNextEnd' ? untilOpponentsNextEnd(ctx.s, ctx.me) : u;
    addMod(ctx.s, { uid, stat: 'negated', amount: 0, until, source });
    log(ctx.s, ctx.me, `les effets de ${def(findField(ctx.s, uid)!.card.num).name} sont annulés (${source})`);
    after?.(ctx, uid);
  },
  useful: (s, p, self) => candidates(s, p, t, undefined, self).length > 0,
});

const negateOneThisTurn = (source: string): Effect => grant(oppLeaderOrChar(), { stat: 'negated' }, 'turn', source, 'a ses effets annulés');

// Catarina Devon : ce Personnage gagne le mot-clé choisi jusqu'à la fin du prochain tour adverse
const selfKeywordUntilOppEnd = (keyword: Keyword, source: string): Effect => effect((ctx) => {
  addMod(ctx.s, { uid: ctx.source, stat: 'keyword', keyword, amount: 0, until: untilOpponentsNextEnd(ctx.s, ctx.me), source });
  log(ctx.s, ctx.me, `${source} gagne [${keyword}] jusqu'à la fin du prochain tour adverse`);
});

// Kuzan : le coût lui-même place le Personnage adverse dans la Vie adverse (au-dessus ou au-dessous, face visible)
const kuzanCost: Cost = {
  label: 'placer 1 Personnage adverse de coût 3 ou moins face visible dans la Vie adverse',
  can: (s, p, self) => candidates(s, p, oppChar({ costMax: 3 }), (c) => canLeaveByEffect(s, c.uid, p), self).length > 0,
  pay: (ctx) => {
    const list = candidates(ctx.s, ctx.me, oppChar({ costMax: 3 }), (c) => canLeaveByEffect(ctx.s, c.uid, ctx.me), ctx.source);
    if (!list.length) return false;
    const answer = ctx.ask({
      prompt: 'Kuzan : Personnage adverse de coût 3 ou moins à placer dans la Vie adverse :',
      options: list.map((uid) => ({ id: `card:${uid}`, label: def(findField(ctx.s, uid)!.card.num).name, uid })),
      tag: 'oppKo',
    });
    const side = ctx.ask({
      prompt: 'Kuzan : au-dessus ou au-dessous de la Vie adverse ?',
      options: [{ id: 'lifeBottom', label: 'Au-dessous' }, { id: 'lifeTop', label: 'Au-dessus' }],
      tag: 'lifeSideOpp',
    });
    return removeByEffect(ctx, Number(answer.split(':')[1]), side === 'lifeTop' ? 'lifeTop' : 'lifeBottom');
  },
};

// Disparais : jusqu'à 2 Personnages adverses dont les puissances, négatives comprises, font 4000 ou moins (Q&A d'OP09,
// n° 2903) ; le premier choisi peut dépasser 4000 si un second le ramène sous le total (il est alors obligatoire)
const TOTAL = 4000;
const targets = (s: GameState, p: PlayerId, self?: number) => candidates(s, p, oppChar(), (c) => canBeKO(s, c.uid, 'effect', p) && canLeaveByEffect(s, c.uid, p), self);
const firstTargets = (s: GameState, p: PlayerId, self?: number) => {
  const list = targets(s, p, self);
  return list.filter((u) => power(s, u) <= TOTAL || list.some((o) => o !== u && power(s, u) + power(s, o) <= TOTAL));
};
const koTwoByTotal: Effect = {
  run: (ctx) => {
    const list = targets(ctx.s, ctx.me, ctx.source);
    const pw = (uid: number) => power(ctx.s, uid);
    const first = firstTargets(ctx.s, ctx.me, ctx.source);
    const pick = (options: number[], prompt: string, optional: boolean) => {
      if (!options.length) return null;
      const answer = ctx.ask({
        prompt,
        options: [...options.map((uid) => ({ id: `card:${uid}`, label: describe(ctx.s, uid), uid })), ...(optional ? [{ id: 'none', label: 'Aucun' }] : [])],
        tag: 'oppKo',
      });
      return answer === 'none' ? null : Number(answer.split(':')[1]);
    };
    const a = pick(first, `Disparais : Personnage adverse à mettre KO (puissance totale de ${TOTAL} ou moins) :`, true);
    if (a === null) return;
    const b = pick(list.filter((o) => o !== a && pw(a) + pw(o) <= TOTAL), 'Disparais : second Personnage adverse à mettre KO :', pw(a) <= TOTAL);
    removeByEffect(ctx, a, 'ko');
    if (b !== null) removeByEffect(ctx, b, 'ko');
  },
  useful: (s, p, self) => firstTargets(s, p, self).length > 0,
};

// Shanks (Leader) : [Une fois par tour], à chaque attaque adverse, il peut s'en servir ou attendre une attaque suivante
// (Q&A d'OP09) : refuser n'use pas l'effet
const SHANKS_KEY = 'op09-001';
const shanksAttack: Effect = {
  run: (ctx) => {
    const self = findField(ctx.s, ctx.source);
    if (!self || self.card.usedOpt.includes(SHANKS_KEY)) return;
    const uid = chooseUpTo1(ctx, candidates(ctx.s, ctx.me, oppLeaderOrChar(), undefined, ctx.source), 'Shanks : Leader ou Personnage adverse qui reçoit −1000 pour le tour :', 'oppPower');
    if (uid === null) return;
    self.card.usedOpt.push(SHANKS_KEY);
    addMod(ctx.s, { uid, stat: 'power', amount: -1000, until: 'turn', source: 'Shanks' });
    log(ctx.s, ctx.me, `${def(findField(ctx.s, uid)!.card.num).name} reçoit −1000 de puissance pour le tour (Shanks)`);
  },
  useful: (s, _p, self) => !findField(s, self)?.card.usedOpt.includes(SHANKS_KEY),
};

// Don Quijote Rosinante : [Attaque adverse] [Une fois par tour] se redresser ; rien n'est utilisé tant qu'il n'est pas épuisé
// (s'il l'est, Q&A d'OP09 : il peut aussi être redressé après un [En attaquant] et bloquer cette attaque)
const ROSINANTE_KEY = 'op09-032';
const rosinanteReady: Effect = {
  run: (ctx) => {
    const self = findField(ctx.s, ctx.source);
    if (!self || !self.card.rested || self.card.usedOpt.includes(ROSINANTE_KEY) || !may(ctx, 'Don Quijote Rosinante : le redresser ?')) return;
    self.card.usedOpt.push(ROSINANTE_KEY);
    setActive(ctx.s, ctx.me, ctx.source);
    log(ctx.s, ctx.me, 'redresse Don Quijote Rosinante');
  },
  useful: (s, _p, self) => { const f = findField(s, self); return Boolean(f?.card.rested && !f.card.usedOpt.includes(ROSINANTE_KEY)); },
};

export const OP09: Record<string, CardBehavior> = {
  'OP09-001': card({ onOpponentAttack: shanksAttack }),

  'OP09-032': card({ onOpponentAttack: rosinanteReady }),

  // Monster : si [Bonk Punch] devait être mis KO par un effet, se placer dans la Défausse à la place
  'OP09-012': {
    koReplaceAlly: {
      label: (_s, _self, victim) => `Monster : se placer dans ta Défausse, ${def(victim.num).name} reste sur le terrain`,
      condition: (s, _p, self, victim) => victim.uid !== self.uid && def(victim.num).names.includes('Bonk Punch') && koByEffect(s, victim),
      apply: (s, p, self, victim, ctx) => {
        const own: EffectCtx = { ...ctx, me: p, opp: other(p), source: self.uid, num: self.num, ask: (q) => ctx.ask({ player: p, ...q }) };
        if (trashByEffect(own, self.uid)) log(s, p, `${def(victim.num).name} reste sur le terrain (Monster)`);
      },
    },
  },

  // Limejuice : [Jouée] jusqu'à 1 Personnage [Bloqueur] adverse de 4000 de puissance ou moins ne peut pas activer [Bloqueur]
  // pour le tour
  'OP09-014': card({ onPlay: grant(oppChar({ powerMax: 4000, keyword: 'Blocker' }), { stat: 'noBlocker' }, 'turn', 'Limejuice', 'ne peut pas activer [Bloqueur]') }),

  // [Principale] mettre KO jusqu'à 2 Personnages adverses de 4000 de puissance totale ou moins
  'OP09-018': card({ onMain: koTwoByTotal }),

  // Lim (Leader) : ses Personnages sont joués épuisés ; [Activation : Principale] [Une fois par tour] ③ : 1 DON!! épuisée
  // en plus, et jouer de sa main 1 Personnage {ODYSSEY} de coût 5 ou moins
  'OP09-022': card({
    activateMain: {
      label: 'Lim : ajouter 1 DON!! épuisée et jouer un Personnage {ODYSSEY} de coût 5 ou moins',
      once: true,
      cost: restDon(3),
      effect: seq(addDonUpTo(1, 'rested', 'Lim'), playFromHandAtCost({ type: 'ODYSSEY', costMax: 5 }, 'Lim')),
    },
  }, { charsPlayedRested: () => true }),

  // Crocodile : [Jouée] jouer de sa main 1 Personnage de coût 5 ou moins, {Cross Guild} ou dont un type inclut « Baroque
  // Works » (le coût vaut pour les deux, comme le dit la VF : interprétation n° 2902)
  'OP09-046': card({ onPlay: playFromHandAtCost({ costMax: 5, anyOf: [{ type: CG }, { typeIncludes: 'Baroque Works' }] }, 'Crocodile') }),

  // Île de Lacrahn-Ri : placer 2 cartes de sa main au-dessous de son deck et épuiser ce Lieu : piocher 2 avec un Leader {Cross Guild}
  'OP09-060': card({
    activateMain: {
      label: 'Île de Lacrahn-Ri : placer 2 cartes de ta main au-dessous de ton deck et piocher 2 cartes',
      cost: bothCosts({
        label: 'placer 2 cartes de ta main au-dessous de ton deck',
        can: (s, p) => s.players[p].hand.length >= 2,
        pay: (ctx) => { handToBottom(2, 'Île de Lacrahn-Ri').run(ctx); return true; },
      }, restSelf()),
      effect: when(leaderType(CG), drawCards(2)),
    },
  }),

  // Monkey D. Luffy (Leader) : [DON!! x1] +1 de coût à ses Personnages ; [Votre tour] [Une fois par tour] quand 2 DON!! ou
  // plus de son terrain sont renvoyées à son deck DON!! : 1 DON!! redressée et 1 DON!! épuisée en plus
  'OP09-061': {
    costAura: (_s, _p, source) => (source.don >= 1 ? 1 : 0),
    when: [{
      on: 'donReturned',
      once: 'op09-061',
      if: (s, owner, _self, e) => s.active === owner && e.player === owner && (e.count ?? 0) >= 2,
      run: (ctx) => {
        // « jusqu'à 1 » chacune : au choix (n° 1994)
        const active = askDonCount(ctx, Math.min(1, ctx.s.players[ctx.me].donDeck), 'Monkey D. Luffy : ajouter 1 DON!! redressée de ton deck DON!! ?') ? addDonFromDeck(ctx.s, ctx.me, 1, true) : 0;
        const rested = askDonCount(ctx, Math.min(1, ctx.s.players[ctx.me].donDeck), 'Monkey D. Luffy : ajouter encore 1 DON!! épuisée de ton deck DON!! ?') ? addDonFromDeck(ctx.s, ctx.me, 1, false) : 0;
        if (active || rested) log(ctx.s, ctx.me, `ajoute ${active ? '1 DON!! redressée' : ''}${active && rested ? ' et ' : ''}${rested ? '1 DON!! épuisée' : ''} (Monkey D. Luffy)`);
      },
    }],
  },

  // Marshall D. Teach (Leader) : ses effets [Jouée] sont annulés ; [Activation : Principale] défausser 1 carte : les effets
  // [Jouée] adverses sont annulés jusqu'à la fin du prochain tour adverse (interprétation n° 2900)
  'OP09-081': card({
    activateMain: {
      label: 'Marshall D. Teach : annuler les effets [Jouée] adverses',
      cost: discardCost(1),
      effect: effect((ctx) => {
        ctx.s.players[ctx.opp].onPlayNegatedUntil = untilOpponentsNextEnd(ctx.s, ctx.me);
        log(ctx.s, ctx.me, 'annule les effets [Jouée] adverses jusqu\'à la fin du prochain tour adverse (Marshall D. Teach)');
      }, (s, p) => (s.players[other(p)].onPlayNegatedUntil ?? -1) < untilOpponentsNextEnd(s, p)),
    },
  }, { ownOnPlayNegated: () => true }),

  // Catarina Devon : [Une fois par tour] avec un Leader {Équipage de Barbe Noire}, gagne au choix [Double attaque], [Exil] ou
  // [Bloqueur] jusqu'à la fin du prochain tour adverse
  'OP09-084': card({
    activateMain: {
      label: 'Catarina Devon : gagner [Double attaque], [Exil] ou [Bloqueur]',
      once: true,
      effect: when(leaderType(BB), chooseOne('Catarina Devon', [
        { label: '[Double attaque]', effect: selfKeywordUntilOppEnd('Double Attack', 'Catarina Devon') },
        { label: '[Exil]', effect: selfKeywordUntilOppEnd('Banish', 'Catarina Devon') },
        { label: '[Bloqueur]', effect: selfKeywordUntilOppEnd('Blocker', 'Catarina Devon') },
      ])),
    },
  }),

  // Marshall D. Teach : épuiser ce Personnage : avec au moins 3 cartes de moins en main que l'adversaire, piocher 2 et défausser 1
  'OP09-092': card({
    activateMain: {
      label: 'Marshall D. Teach : piocher 2 cartes et défausser 1 carte',
      cost: restSelf(),
      effect: when((s, p) => s.players[p].hand.length + 3 <= s.players[other(p)].hand.length, seq(drawCards(2), discard(1))),
    },
  }),

  // Marshall D. Teach : [Une fois par tour] avec un Leader {Équipage de Barbe Noire}, s'il a été joué ce tour : annuler les
  // effets du Leader adverse pour le tour ; puis annuler les effets de 1 Personnage adverse, qui ne peut plus attaquer,
  // les deux jusqu'à la fin du prochain tour adverse (interprétation n° 2901)
  'OP09-093': card({
    activateMain: {
      label: 'Marshall D. Teach : annuler les effets du Leader et d\'un Personnage adverses',
      once: true,
      condition: all(leaderType(BB), (s, _p, self) => findField(s, self)?.card.playedTurn === s.turn),
      effect: seq(
        grant(oppLeader(), { stat: 'negated' }, 'turn', 'Marshall D. Teach', 'a ses effets annulés'),
        negateChosen(oppChar(), 'oppNextEnd', 'Marshall D. Teach', 'dont les effets sont annulés et qui ne peut plus attaquer', (ctx, uid) => {
          addMod(ctx.s, { uid, stat: 'cantAttack', amount: 0, until: untilOpponentsNextEnd(ctx.s, ctx.me), source: 'Marshall D. Teach' });
        }),
      ),
    },
  }),

  // Tourbillon noir : [Contre] annuler les effets de 1 Leader ou Personnage adverse pour le tour, et il reçoit −4000 pour le
  // tour ; [Déclenchement] annuler les effets de 1 Leader ou Personnage adverse pour le tour
  'OP09-097': card({
    onCounter: negateChosen(oppLeaderOrChar(), 'turn', 'Tourbillon noir', 'dont les effets sont annulés et qui reçoit −4000', (ctx, uid) => {
      addMod(ctx.s, { uid, stat: 'power', amount: -4000, until: 'turn', source: 'Tourbillon noir' });
    }),
    onTrigger: negateOneThisTurn('Tourbillon noir'),
  }, {
    // l'attaque est repoussée si −4000 sur l'attaquant suffit (l'IA n'estime que les bonus de la carte attaquée)
    counterExtra: (s) => Boolean(s.battle) && power(s, s.battle!.attacker) - 4000 < power(s, s.battle!.target),
  }),

  // Black Hole : [Principale] avec un Leader {Équipage de Barbe Noire}, annuler les effets de 1 Personnage adverse pour le
  // tour, puis le mettre KO s'il a un coût de 4 ou moins ; [Déclenchement] annuler les effets de 1 Leader ou Personnage adverse
  'OP09-098': card({
    onMain: when(leaderType(BB), negateChosen(oppChar(), 'turn', 'Black Hole', 'dont les effets sont annulés', (ctx, uid) => {
      if (fieldCost(ctx.s, uid) <= 4) removeByEffect(ctx, uid, 'ko');
    })),
    onTrigger: negateOneThisTurn('Black Hole'),
  }),

  // Kuzan : [Jouée] placer 1 Personnage adverse de coût 3 ou moins dans la Vie adverse (coût) : l'adversaire défausse 1 carte
  'OP09-101': card({ onPlay: withCost(kuzanCost, oppDiscards(1), 'Kuzan') }),

  // Gol D. Roger : [Initiative] (mot-clé du catalogue) ; quand l'adversaire active [Bloqueur], si l'un des joueurs n'a plus
  // de Vie, le propriétaire gagne
  'OP09-118': {
    when: [{
      on: 'block',
      if: (s, owner, _self, e) => e.player !== owner && s.players.some((P) => P.life.length === 0),
      run: (ctx) => {
        if (ctx.s.winner !== null || !ctx.s.players.some((P) => P.life.length === 0)) return;
        ctx.s.winner = ctx.me;
        ctx.s.winReason = `${ctx.s.players[ctx.me].name} gagne : l'adversaire a activé [Bloqueur] (Gol D. Roger)`;
        log(ctx.s, null, ctx.s.winReason);
      },
    }],
  },
};

// Rien de codé à la main n'est appelé par une recette d'OP09 pour l'instant (sortie « manual », 01-contrats.md § 15.2)
export const MANUAL_OP09 = {};
