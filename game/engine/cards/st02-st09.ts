// ST-02 À ST-09 CODÉES À LA MAIN (étape C, tâche S17) : celles que le traducteur ne comprend pas (remplacements, évènements de
// combat, « cette carte dans votre main » au [Déclenchement]). Codées d'après leur texte officiel VO (et VF quand le catalogue
// l'a) et les Q&A officielles ; les choix d'interprétation sont dans game/docs/interpretations.md (section « ST-02 à ST-09
// (tâche S17) », 3600 à 3699). Aucun texte de carte ici. Le reste des sets est en recettes (recipes/sets/st02.ts ... st09.ts).
import {
  addMod, canPlayCharacters, chooseUpToN, def, findField, log, may, other, playCharacter, removeByEffect, reveal, setActive, shuffleDeck, uniqueByNum,
} from '../rules.ts';
import type { CardBehavior, EffectCtx, FieldCard, GameEvent, GameState, PlayerId } from '../types.ts';
import {
  addDon, candidates, card, cardMatches, costMod, describeSpec, donMinus, effect, ko, oppChar, ownLeaderOrChar, rest, restDon, restSelf,
  selfDon, selfPowerMod, seq, trashLifeCost, type CharSpec, type Effect,
} from './bricks.ts';

// Le contexte d'un effet adverse, vu du propriétaire de la carte qui le remplace : ses questions vont à ce joueur
const ownerCtx = (ctx: EffectCtx, owner: PlayerId): EffectCtx => ({
  ...ctx, me: owner, opp: other(owner), ask: (spec) => ctx.ask({ player: owner, ...spec }),
});

// « Ajoutez cette carte à votre main » ([Déclenchement], obligatoire : Q&A d'Uzuki Tempura) : ce n'est pas une carte de Vie
// ajoutée à la main par un effet (Q&A de Spacey OP05-107) ; comme Pacifista OP12-109
const triggerToHand: Effect = effect((ctx) => {
  if (!ctx.trigger) return;
  ctx.trigger.moved = true;
  ctx.s.players[ctx.me].hand.push(ctx.trigger.card);
  reveal(ctx.s, [ctx.trigger.card.uid], 'both');
  log(ctx.s, ctx.me, `ajoute ${def(ctx.trigger.card.num).name} à sa main`);
});

// La carte adverse du combat annoncé par 'battleStart' ou 'battleEnd', vue de `self` : l'autre carte du combat
const foe = (self: FieldCard, e: GameEvent) => (e.uid === self.uid ? e.target : e.target === self.uid ? e.uid : undefined);

// Basil Hawkins : à la fin du combat, si la comparaison a eu lieu (une cible partie du terrain coupe le combat : Q&A) et que la
// carte attaquée, ou le bloqueur, était un Personnage, même mis KO ou remplacé (Q&A, n° 3600)
const hawkinsIf = (s: GameState, owner: PlayerId, self: FieldCard, e: GameEvent) => s.active === owner && e.uid === self.uid && self.don >= 1
  && Boolean(s.battle?.fought) && e.target !== s.players[other(owner)].leader.uid;

// Zephyr : un Personnage <Strike>, attaquant ou attaqué, en face de lui quand le combat est fixé (n° 3601). Un Leader n'est pas un Personnage
const zephyrIf = (s: GameState, owner: PlayerId, self: FieldCard, e: GameEvent) => {
  const uid = foe(self, e);
  if (uid === undefined) return false;
  const f = findField(s, uid);
  return Boolean(f) && f!.player === other(owner) && !f!.leader && !f!.stage && def(f!.card.num).attributes.includes('Strike');
};

// Mr.2 : le Personnage adverse du combat est encore sur le terrain ; ce Personnage aussi (emit ne lit que le terrain) et il a 1 DON!! donnée.
// Son propriétaire choisit de le mettre KO ou non ; s'il ne peut pas l'être, « Si vous le faites » est faux (n° 3602)
const mr2If = (s: GameState, owner: PlayerId, self: FieldCard, e: GameEvent) => {
  if (self.don < 1) return false;
  const uid = foe(self, e);
  if (uid === undefined) return false;
  const f = findField(s, uid);
  return Boolean(f) && f!.player === other(owner) && !f!.leader && !f!.stage;
};
const mr2Run = (ctx: EffectCtx, e: GameEvent) => {
  const self = findField(ctx.s, ctx.source);
  if (!self) return;
  const uid = foe(self.card, e)!;
  const f = findField(ctx.s, uid);
  if (!f || !may(ctx, `Mr.2.Bon.Kurei : mettre KO ${def(f.card.num).name} ?`)) return;
  if (removeByEffect(ctx, uid, 'ko')) removeByEffect(ctx, ctx.source, 'ko');
};

// Sentomaru : « jouez ... de votre deck, puis mélangez » : le deck est regardé et mélangé même sans carte à jouer (Q&A) ; comme
// Count Niwatori OP08-071
const SENTOMARU_SPEC: CharSpec = { name: 'Pacifista', costMax: 4 };
const sentomaruFits = (s: GameState, p: PlayerId, num: string) => def(num).category === 'CHARACTER' && cardMatches(num, SENTOMARU_SPEC) && canPlayCharacters(s, p, num);
const sentomaruPlay: Effect = {
  run: (ctx) => {
    const P = ctx.s.players[ctx.me];
    const options = canPlayCharacters(ctx.s, ctx.me) ? uniqueByNum(P.deck.filter((c) => sentomaruFits(ctx.s, ctx.me, c.num))) : [];
    if (options.length) {
      const answer = ctx.ask({
        prompt: `Sentomaru : jouer jusqu’à 1 ${describeSpec('Personnage', SENTOMARU_SPEC)} de ton deck :`,
        options: [...options.map((c) => ({ id: `card:${c.uid}`, label: `${def(c.num).name} (coût ${def(c.num).cost})`, uid: c.uid, num: c.num })), { id: 'none', label: 'Aucun' }],
        tag: 'playFree',
      });
      if (answer !== 'none') {
        const [c] = P.deck.splice(P.deck.findIndex((x) => x.uid === Number(answer.split(':')[1])), 1);
        playCharacter(ctx, ctx.me, c);
      }
    }
    shuffleDeck(ctx.s, ctx.me);
    log(ctx.s, ctx.me, 'mélange son deck (Sentomaru)');
  },
  useful: (s, p) => s.players[p].deck.some((c) => sentomaruFits(s, p, c.num)),
};

// Union Armada : jusqu'à 1 Leader ou Personnage {FILM} : +4000 pour le combat ; un Personnage ne peut pas non plus être mis KO, ni
// en combat ni par un effet, jusqu'à la fin du tour (Q&A)
const FILM_TARGETS = ownLeaderOrChar({ type: 'FILM' });
const unionArmada: Effect = {
  run: (ctx) => {
    for (const uid of chooseUpToN(ctx, candidates(ctx.s, ctx.me, FILM_TARGETS, undefined, ctx.source), 1, 'Union Armada : Leader ou Personnage {FILM} qui gagne +4000 de puissance :', 'ownPower')) {
      const f = findField(ctx.s, uid)!;
      addMod(ctx.s, { uid, stat: 'power', amount: 4000, until: 'battle', source: 'Union Armada' });
      log(ctx.s, ctx.me, `${def(f.card.num).name} gagne +4000 de puissance pour le combat (Union Armada)`);
      if (!f.leader) {
        addMod(ctx.s, { uid, stat: 'cantBeKO', amount: 0, until: 'turn', source: 'Union Armada' });
        log(ctx.s, ctx.me, `${def(f.card.num).name} ne peut pas être mis KO pour tout le tour (Union Armada)`);
      }
    }
  },
  useful: (s, p, self) => candidates(s, p, FILM_TARGETS, undefined, self).length > 0,
  power: () => 4000,
};

const ACE_KEY = 'aceST09';

export const ST_S17: Record<string, CardBehavior> = {
  // Basil Hawkins : [DON!! x1] [Une fois par tour] [Votre tour] se redresse à la fin d'un combat contre un Personnage (voir plus haut)
  'ST02-010': {
    when: [{
      on: 'battleEnd',
      once: 'hawkins',
      if: hawkinsIf,
      run: (ctx) => { setActive(ctx.s, ctx.me, ctx.source); },
    }],
  },

  // Sentomaru : [DON!! x1] [Activation : Principale] [Une fois par tour] ➁ : [Pacifista] de coût 4 ou moins du deck, puis mélange
  'ST03-007': card({
    activateMain: { label: 'Jouer un [Pacifista] de ton deck', once: true, condition: selfDon(1), cost: restDon(2), effect: sentomaruPlay },
  }),

  // Zephyr : +3000 pour le tour à chaque combat contre un Personnage <Strike>, cumulable (Q&A) ; [Activation : Principale]
  // [Une fois par tour] DON!! −1 : +2000 pour le tour
  'ST05-010': card({
    activateMain: { label: 'Gagner +2000 de puissance', once: true, cost: donMinus(1), effect: selfPowerMod(2000, 'turn', 'Zephyr') },
  }, {
    when: [{ on: 'battleStart', if: zephyrIf, run: (ctx) => selfPowerMod(3000, 'turn', 'Zephyr').run(ctx) }],
  }),

  // Union Armada : voir plus haut ; [Déclenchement] jusqu'à 1 DON!! de son deck DON!!, redressée
  'ST05-017': card({ onCounter: unionArmada, onTrigger: addDon(1, 'active') }),

  // Uta : ne peut pas être mise KO en combat par un Leader ; [Activation : Principale] s'épuiser : −2 de coût
  'ST08-002': card({
    activateMain: { label: 'Donner −2 de coût à un Personnage adverse', cost: restSelf(), effect: costMod(oppChar(), -2, 'turn', 'Uta') },
  }, {
    cantBeKO: (s, _owner, _self, cause, by) => cause === 'battle' && s.battle?.attacker === s.players[by].leader.uid,
  }),

  // Mr.2.Bon.Kurei : [DON!! x1] à la fin d'un combat contre un Personnage adverse, attaquant, attaqué ou bloqueur : voir plus haut.
  // Mis KO dans le combat, il n'est plus sur le terrain : rien (Q&A)
  'ST08-013': {
    when: [{ on: 'battleEnd', if: mr2If, run: mr2Run }],
  },

  // Uzuki Tempura : [Déclenchement] épuiser jusqu'à 1 Personnage adverse de coût 2 ou moins, et cette carte dans la main
  'ST09-002': card({ onTrigger: seq(rest(oppChar({ costMax: 2 }), 'Uzuki Tempura'), triggerToHand) }),

  // Fugetsu Omusubi : [Déclenchement] KO de jusqu'à 1 Personnage adverse de coût 1 ou moins, et cette carte dans la main
  'ST09-009': card({ onTrigger: seq(ko(oppChar({ costMax: 1 }), 'Fugetsu Omusubi'), triggerToHand) }),

  // Portgas.D.Ace : [Une fois par tour] s'il devait être mis KO, la carte du dessus ou du dessous de sa Vie dans sa Défausse à la
  // place ; sans Vie, pas de remplacement (Q&A)
  'ST09-010': card({}, {
    koReplace: {
      label: 'Placer dans ta Défausse la carte du dessus ou du dessous de ta Vie',
      condition: (s, p, self) => !self.usedOpt.includes(ACE_KEY) && s.players[p].life.length > 0,
      apply: (_s, p, self, ctx) => {
        self.usedOpt.push(ACE_KEY);
        trashLifeCost('both').pay(ownerCtx(ctx, p));
      },
    },
  }),
};
