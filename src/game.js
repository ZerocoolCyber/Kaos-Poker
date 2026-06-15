'use strict';

const SUITS = ['s', 'h', 'd', 'c'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

function createDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function evalHand(cards) {
  const combos = getCombinations(cards, 5);
  let best = null;
  for (const combo of combos) {
    const score = score5(combo);
    if (!best || compareScores(score, best) > 0) {
      best = score;
      best.cards = combo;
    }
  }
  return best;
}

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function score5(cards) {
  const ranks = cards.map(c => RANK_VAL[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(ranks);
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const groupCounts = groups.map(g => parseInt(g[1]));
  const groupRanks = groups.map(g => parseInt(g[0]));

  if (isFlush && isStraight) return { rank: 8, tiebreakers: [isStraight === 'wheel' ? 5 : ranks[0]], name: ranks[0] === 14 && ranks[1] === 13 ? 'Royal Flush' : 'Straight Flush' };
  if (groupCounts[0] === 4) return { rank: 7, tiebreakers: [groupRanks[0], groupRanks[1]], name: 'Four of a Kind' };
  if (groupCounts[0] === 3 && groupCounts[1] === 2) return { rank: 6, tiebreakers: [groupRanks[0], groupRanks[1]], name: 'Full House' };
  if (isFlush) return { rank: 5, tiebreakers: ranks, name: 'Flush' };
  if (isStraight) return { rank: 4, tiebreakers: [isStraight === 'wheel' ? 5 : ranks[0]], name: 'Straight' };
  if (groupCounts[0] === 3) return { rank: 3, tiebreakers: [groupRanks[0], ...groupRanks.slice(1)], name: 'Three of a Kind' };
  if (groupCounts[0] === 2 && groupCounts[1] === 2) return { rank: 2, tiebreakers: [Math.max(groupRanks[0], groupRanks[1]), Math.min(groupRanks[0], groupRanks[1]), groupRanks[2]], name: 'Two Pair' };
  if (groupCounts[0] === 2) return { rank: 1, tiebreakers: [groupRanks[0], ...groupRanks.slice(1)], name: 'One Pair' };
  return { rank: 0, tiebreakers: ranks, name: 'High Card' };
}

function checkStraight(sortedRanks) {
  const wheel = [14, 5, 4, 3, 2];
  if (JSON.stringify(sortedRanks) === JSON.stringify(wheel)) return 'wheel';
  for (let i = 0; i < sortedRanks.length - 1; i++) {
    if (sortedRanks[i] - sortedRanks[i + 1] !== 1) return false;
  }
  return true;
}

function compareScores(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const diff = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

class PokerGame {
  constructor(config) {
    this.id = config.id;
    this.mode = config.mode || 'lan'; 
    this.gameType = config.gameType || 'cash'; 
    this.startingChips = config.startingChips || 1000;
    this.maxPlayers = config.maxPlayers || 8;
    
    this.initialSmallBlind = config.smallBlind || 10;
    this.initialBigBlind = config.bigBlind || 20;
    this.smallBlind = this.initialSmallBlind;
    this.bigBlind = this.initialBigBlind;

    this.maxRebuys = config.maxRebuys !== undefined ? config.maxRebuys : -1;
    this.allowRebuy = this.maxRebuys !== 0;
    this.rebuyAmount = config.rebuyAmount || config.startingChips || 1000;

    this.blindLevelDuration = config.blindDuration || 15; 
    this.currentBlindLevel = 0;
    this.blindTimer = null;
    
    this.blindLevels = [
      { sb: this.initialSmallBlind, bb: this.initialBigBlind },
      { sb: this.initialSmallBlind * 2, bb: this.initialBigBlind * 2 },
      { sb: this.initialSmallBlind * 3, bb: this.initialBigBlind * 3 },
      { sb: this.initialSmallBlind * 5, bb: this.initialBigBlind * 5 },
      { sb: this.initialSmallBlind * 10, bb: this.initialBigBlind * 10 },
      { sb: this.initialSmallBlind * 15, bb: this.initialBigBlind * 15 },
      { sb: this.initialSmallBlind * 20, bb: this.initialBigBlind * 20 },
      { sb: this.initialSmallBlind * 30, bb: this.initialBigBlind * 30 },
      { sb: this.initialSmallBlind * 50, bb: this.initialBigBlind * 50 },
    ];

    this.players = {}; 
    this.spectators = {};
    this.seats = new Array(this.maxPlayers).fill(null); 
    this.chat = [];

    this.phase = 'waiting'; 
    this.isContested = false; // Tracks if cards should be revealed

    this.deck = [];
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.currentBet = 0;
    this.dealerSeat = -1;
    this.actionSeat = -1;
    this.handCount = 0;
    this.lastRaiseAmount = 0;
  }

  addPlayer(socketId, name, avatarId = 0) {
    const seat = this.seats.indexOf(null);
    if (seat === -1) return { error: 'Game is full' };
    if (Object.values(this.players).find(p => p.name === name)) return { error: 'Name taken' };

    const isMidHand = this.phase !== 'waiting' && this.phase !== 'game_over';

    this.players[socketId] = {
      id: socketId, name, avatarId, seat,
      chips: this.startingChips, holeCards: [],
      bet: 0, totalBetThisHand: 0,
      folded: false, allIn: false, 
      isActive: !isMidHand,
      hasActed: false, lastAction: null,
      rebuyCount: 0, autoRebuy: false, isBusted: false
    };
    this.seats[seat] = socketId;
    return { seat };
  }

  addSpectator(socketId, name) {
    this.spectators[socketId] = { id: socketId, name };
    return { ok: true };
  }

  removePlayer(socketId) {
    const player = this.players[socketId];
    if (!player) { delete this.spectators[socketId]; return; }
    this.seats[player.seat] = null;
    delete this.players[socketId];
  }

  getActivePlayers() {
    return this.seats
      .filter(id => id && this.players[id] && !this.players[id].isBusted)
      .map(id => this.players[id]);
  }

  getActivePlayersInHand() {
    return this.getActivePlayers().filter(p => p.isActive && !p.folded);
  }

  canStartGame() {
    const readyPlayers = this.getActivePlayers().filter(p => p.chips > 0 || (p.chips === 0 && p.isActive));
    // FIX: Allows the host to force-start a hand even during the 8-second showdown delay
    return readyPlayers.length >= 2 && (this.phase === 'waiting' || this.phase === 'game_over' || this.phase === 'showdown');
  }

  restartGame() {
    this.phase = 'waiting';
    this.handCount = 0;
    this.communityCards = [];
    this.pot = 0;
    
    this.currentBlindLevel = 0;
    this.smallBlind = this.initialSmallBlind;
    this.bigBlind = this.initialBigBlind;

    for (const p of Object.values(this.players)) {
        p.chips = this.startingChips;
        p.isBusted = false;
        p.isActive = true;
        p.rebuyCount = 0;
        p.holeCards = [];
        p.folded = false;
        p.allIn = false;
        p.bet = 0;
        p.lastAction = null;
    }
  }

  startHand() {
    if (this.phase === 'game_over') this.restartGame();
    
    const active = this.getActivePlayers().filter(p => p.chips > 0);
    if (active.length < 2) return { error: 'Need at least 2 players with chips' };

    this.handCount++;
    this.deck = shuffle(createDeck());
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.currentBet = 0;
    this.lastRaiseAmount = this.bigBlind;
    this.isContested = false;

    for (const p of active) {
      p.holeCards = []; p.bet = 0; p.totalBetThisHand = 0;
      p.folded = false; p.allIn = false; p.hasActed = false; p.lastAction = null;
      p.isActive = true; 
    }

    this.dealerSeat = this.nextActiveSeatFrom(this.dealerSeat, active);
    const sbSeat = active.length === 2 ? this.dealerSeat : this.nextActiveSeatFromIndex(this.dealerSeat, active, 1);
    const bbSeat = active.length === 2 ? this.nextActiveSeatFromIndex(this.dealerSeat, active, 1) : this.nextActiveSeatFromIndex(this.dealerSeat, active, 2);

    const sbPlayer = active.find(p => p.seat === sbSeat);
    const bbPlayer = active.find(p => p.seat === bbSeat);

    this.postBlind(sbPlayer, this.smallBlind);
    this.postBlind(bbPlayer, this.bigBlind);
    this.currentBet = this.bigBlind;

    for (let i = 0; i < 2; i++) {
      for (const p of active) p.holeCards.push(this.deck.pop());
    }

    this.phase = 'preflop';
    this.actionSeat = this.nextActiveSeatFromIndex(bbSeat, active, 1);
    if (bbPlayer) bbPlayer.hasActed = false;

    return { dealerSeat: this.dealerSeat, sbSeat, bbSeat, actionSeat: this.actionSeat };
  }

  nextActiveSeatFrom(fromSeat, activePlayers) {
    const seats = activePlayers.map(p => p.seat).sort((a, b) => a - b);
    const next = seats.find(s => s > fromSeat);
    return next !== undefined ? next : seats[0];
  }

  nextActiveSeatFromIndex(fromSeat, activePlayers, steps) {
    const seats = activePlayers.map(p => p.seat).sort((a, b) => a - b);
    let idx = seats.indexOf(fromSeat);
    if (idx === -1) idx = 0;
    return seats[(idx + steps) % seats.length];
  }

  postBlind(player, amount) {
    if (!player) return;
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.bet = actual;
    player.totalBetThisHand = actual;
    this.pot += actual;
    if (player.chips === 0) player.allIn = true;
  }

  playerAction(socketId, action, amount) {
    const player = this.players[socketId];
    if (!player) return { error: 'Player not found' };
    if (player.seat !== this.actionSeat) return { error: 'Not your turn' };
    if (player.folded || player.allIn || !player.isActive) return { error: 'Cannot act' };

    switch (action) {
      case 'fold':
        player.folded = true; player.hasActed = true; player.holeCards = [];
        player.lastAction = 'FOLD';
        break;
      case 'check':
        if (player.bet < this.currentBet) return { error: 'Cannot check' };
        player.hasActed = true;
        player.lastAction = 'CHECK';
        break;
      case 'call': {
        const callAmt = Math.min(this.currentBet - player.bet, player.chips);
        player.chips -= callAmt; player.bet += callAmt;
        player.totalBetThisHand += callAmt; this.pot += callAmt;
        player.lastAction = 'CALL';
        if (player.chips === 0) { player.allIn = true; player.lastAction = 'ALL-IN'; }
        player.hasActed = true;
        break;
      }
      case 'raise': {
        if (amount < this.currentBet + this.lastRaiseAmount && amount + player.bet < player.chips + player.bet) {
            return { error: `Min raise is ${this.currentBet + this.lastRaiseAmount}` };
        }
        const raiseTotal = Math.min(amount, player.chips + player.bet);
        const raiseBy = raiseTotal - player.bet;
        this.lastRaiseAmount = Math.max(raiseTotal - this.currentBet, this.lastRaiseAmount);
        player.chips -= raiseBy; this.pot += raiseBy;
        player.bet = raiseTotal; player.totalBetThisHand += raiseBy;
        this.currentBet = raiseTotal;
        player.lastAction = 'RAISE';
        if (player.chips === 0) { player.allIn = true; player.lastAction = 'ALL-IN'; }
        player.hasActed = true;
        this.getActivePlayersInHand().forEach(p => { if (p.id !== socketId && !p.allIn) p.hasActed = false; });
        break;
      }
      case 'allin': {
        const allInAmt = player.chips;
        if (player.bet + allInAmt > this.currentBet) {
          this.lastRaiseAmount = Math.max(player.bet + allInAmt - this.currentBet, this.lastRaiseAmount);
          this.currentBet = player.bet + allInAmt;
          this.getActivePlayersInHand().forEach(p => { if (p.id !== socketId && !p.allIn) p.hasActed = false; });
        }
        this.pot += allInAmt; player.bet += allInAmt;
        player.totalBetThisHand += allInAmt; player.chips = 0;
        player.allIn = true; player.hasActed = true;
        player.lastAction = 'ALL-IN';
        break;
      }
      default: return { error: 'Unknown action' };
    }
    return this.advanceAction();
  }

  advanceAction() {
    const inHand = this.getActivePlayersInHand();
    if (inHand.length === 1) return this.endHand();

    const needToAct = inHand.filter(p => !p.allIn && (!p.hasActed || p.bet < this.currentBet));
    const notAllIn = inHand.filter(p => !p.allIn);

    if (needToAct.length === 0) {
      if (notAllIn.length <= 1 && inHand.length > 1) return this.runItOut();
      return this.nextStreet();
    }

    const active = this.getActivePlayersInHand();
    let nextSeat = this.actionSeat;
    let found = false;
    for (let i = 0; i < this.maxPlayers; i++) {
      nextSeat = this.nextActiveSeatFrom(nextSeat, active);
      const p = active.find(pl => pl.seat === nextSeat);
      if (p && !p.folded && !p.allIn && (!p.hasActed || p.bet < this.currentBet)) { found = true; break; }
      if (nextSeat === this.actionSeat) break;
    }

    if (!found) return this.nextStreet();
    this.actionSeat = nextSeat;
    return { phase: this.phase, actionSeat: this.actionSeat };
  }

  nextStreet() {
    const inHand = this.getActivePlayersInHand();
    for (const p of inHand) { 
        p.bet = 0; 
        p.hasActed = false; 
        if (p.lastAction !== 'ALL-IN') p.lastAction = null;
    }
    this.currentBet = 0;
    this.lastRaiseAmount = this.bigBlind;

    if (this.phase === 'preflop') {
      this.phase = 'flop';
      this.deck.pop(); 
      this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    } else if (this.phase === 'flop') {
      this.phase = 'turn';
      this.deck.pop(); this.communityCards.push(this.deck.pop());
    } else if (this.phase === 'turn') {
      this.phase = 'river';
      this.deck.pop(); this.communityCards.push(this.deck.pop());
    } else if (this.phase === 'river') {
      return this.showdown();
    }

    const active = this.getActivePlayersInHand();
    const notAllIn = inHand.filter(p => !p.allIn);
    if (notAllIn.length <= 1) return this.runItOut();

    this.actionSeat = this.nextActiveSeatFrom(this.dealerSeat, active);
    let attempts = 0;
    while (attempts < this.maxPlayers) {
      const p = active.find(pl => pl.seat === this.actionSeat);
      if (p && !p.folded && !p.allIn) break;
      this.actionSeat = this.nextActiveSeatFrom(this.actionSeat, active);
      attempts++;
    }

    return { phase: this.phase, actionSeat: this.actionSeat, communityCards: this.communityCards };
  }

  runItOut() {
    while (this.communityCards.length < 5) {
      if (this.communityCards.length === 3 || this.communityCards.length === 4) this.deck.pop();
      this.communityCards.push(this.deck.pop());
    }
    return this.showdown();
  }

  checkGameEnd(baseResult) {
    const survivors = this.getActivePlayers();
    if (this.handCount > 0 && survivors.length === 1 && Object.keys(this.players).length > 1) {
        this.phase = 'game_over';
        baseResult.phase = 'game_over';
        baseResult.tournamentWinner = survivors[0];
    } else {
        // FIX: Freeze the state on showdown so cards stay decrypted during the 8-second delay!
        this.phase = 'showdown'; 
    }
    return baseResult;
  }

  showdown() {
    this.phase = 'showdown';
    this.isContested = true; // Tell the server it is safe to unencrypt the cards
    const inHand = this.getActivePlayersInHand();
    const results = this.calculateWinners(inHand);
    
    for (const p of this.getActivePlayers()) {
      if (p.chips === 0) {
        const canRebuy = this.allowRebuy && (this.maxRebuys === -1 || p.rebuyCount < this.maxRebuys);
        if (canRebuy && p.autoRebuy) {
          p.chips = this.rebuyAmount;
          p.rebuyCount++;
          p.isActive = true;
          p.lastAction = null;
          results.systemChat = results.systemChat || [];
          results.systemChat.push(`${p.name} automatically rebought for ${this.rebuyAmount} chips.`);
        } else if (!canRebuy) {
          p.isBusted = true;
          p.isActive = false;
        } else {
          p.isActive = false; 
        }
      }
    }

    return this.checkGameEnd({ phase: 'showdown', results, communityCards: this.communityCards });
  }

  endHand() {
    this.phase = 'showdown';
    this.isContested = false; // Hand was uncontested (everyone else folded). Keep cards hidden!

    const winner = this.getActivePlayersInHand()[0];
    winner.chips += this.pot;
    const results = [{ players: [winner], pot: this.pot, reason: 'uncontested' }];
    
    for (const p of this.getActivePlayers()) {
      if (p.chips === 0) {
        const canRebuy = this.allowRebuy && (this.maxRebuys === -1 || p.rebuyCount < this.maxRebuys);
        if (canRebuy && p.autoRebuy) {
          p.chips = this.rebuyAmount;
          p.rebuyCount++;
          p.isActive = true;
          p.lastAction = null;
          results.systemChat = results.systemChat || [];
          results.systemChat.push(`${p.name} automatically rebought for ${this.rebuyAmount} chips.`);
        } else if (!canRebuy) {
          p.isBusted = true;
          p.isActive = false;
        } else {
          p.isActive = false; 
        }
      }
    }

    this.pot = 0;
    return this.checkGameEnd({ phase: 'showdown', results, communityCards: this.communityCards });
  }

  calculateWinners(players) {
    const allContributions = players.map(p => ({ id: p.id, total: p.totalBetThisHand }))
      .concat(this.getActivePlayers().filter(p => p.folded).map(p => ({ id: p.id, total: p.totalBetThisHand })));

    const pots = this.buildSidePots(allContributions, players);
    const results = [];

    for (const pot of pots) {
      const eligible = pot.eligible;
      if (eligible.length === 1) {
        eligible[0].chips += pot.amount;
        results.push({ players: eligible, pot: pot.amount, reason: 'uncontested' });
        continue;
      }

      const scored = eligible.map(p => ({ player: p, score: evalHand([...p.holeCards, ...this.communityCards]) }));
      scored.sort((a, b) => compareScores(b.score, a.score));
      const best = scored[0].score;
      const winners = scored.filter(s => compareScores(s.score, best) === 0).map(s => s.player);
      const share = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount - share * winners.length;

      winners.forEach((w, i) => { w.chips += share + (i === 0 ? remainder : 0); });
      results.push({ players: winners, pot: pot.amount, handName: best.name, bestCards: best.cards, allHands: scored.map(s => ({ player: s.player, handName: s.score.name })) });
    }
    return results;
  }

  buildSidePots(contributions, inHand) {
    const sorted = [...contributions].sort((a, b) => a.total - b.total);
    const pots = [];
    let prev = 0;

    for (const contrib of sorted) {
      if (contrib.total <= prev) continue;
      const level = contrib.total;
      const actualAmount = contributions.reduce((sum, c) => sum + Math.min(Math.max(c.total - prev, 0), level - prev), 0);
      const eligible = inHand.filter(p => p.totalBetThisHand >= level);
      if (eligible.length > 0 && actualAmount > 0) pots.push({ amount: actualAmount, eligible });
      prev = level;
    }
    return pots;
  }

  getRoomState(forSocketId) {
    // FIX: Unencrypt the hole cards officially on the server if it's a contested showdown!
    const revealCards = this.phase === 'game_over' || (this.phase === 'showdown' && this.isContested);

    const players = {};
    for (const [id, p] of Object.entries(this.players)) {
      players[id] = {
        id: p.id, name: p.name, avatarId: p.avatarId, seat: p.seat, chips: p.chips, bet: p.bet,
        folded: p.folded, allIn: p.allIn, isActive: p.isActive, hasActed: p.hasActed, cardCount: p.holeCards.length,
        rebuyCount: p.rebuyCount, autoRebuy: p.autoRebuy, isBusted: p.isBusted, lastAction: p.lastAction,
        holeCards: (id === forSocketId || revealCards) ? p.holeCards : (p.holeCards.length > 0 ? [{ rank: '?', suit: '?' }, { rank: '?', suit: '?' }] : []),
      };
    }
    return {
      gameId: this.id, mode: this.mode, gameType: this.gameType, phase: this.phase,
      players, spectators: this.spectators, seats: this.seats, maxPlayers: this.maxPlayers,
      communityCards: this.communityCards, pot: this.pot, currentBet: this.currentBet,
      dealerSeat: this.dealerSeat, actionSeat: this.actionSeat,
      smallBlind: this.smallBlind, bigBlind: this.bigBlind, handCount: this.handCount,
      allowRebuy: this.allowRebuy, maxRebuys: this.maxRebuys, rebuyAmount: this.rebuyAmount, blindLevel: this.currentBlindLevel,
    };
  }
}

module.exports = { PokerGame, evalHand, compareScores };