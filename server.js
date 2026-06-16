'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { PokerGame } = require('./src/game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const games = {};
// NEW: Decouples identity from live connection. Maps socket.id to token payload.
const socketMap = {}; 

function generateGameId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));

app.post('/create-game', (req, res) => {
  const config = req.body;
  const id = generateGameId();
  config.id = id;
  games[id] = new PokerGame(config);
  res.json({ gameId: id });
});

io.on('connection', (socket) => {
  function getGame(gameId) { return games[gameId]; }

  function broadcastState(gameId) {
    const game = games[gameId];
    if (!game) return;
    io.sockets.sockets.forEach((s) => {
      if (s.rooms.has(gameId)) {
         const info = socketMap[s.id];
         if (info) s.emit('game_state', game.getRoomState(info.token));
      }
    });
  }

  function clearClock(game, gameId) {
    if (game.clockTimer) {
      clearInterval(game.clockTimer);
      game.clockTimer = null;
      io.to(gameId).emit('clock_clear');
    }
  }

  // AUTO-FOLD ENGINE: If the action lands on an offline player, forcefully advance it.
  function checkAutoFold(gameId) {
    const game = games[gameId];
    if (game && game.phase !== 'waiting' && game.phase !== 'showdown' && game.phase !== 'game_over') {
        const actingToken = game.seats[game.actionSeat];
        const actingPlayer = game.players[actingToken];
        
        if (actingPlayer && actingPlayer.isDisconnected) {
            // Wait 1.5 seconds so the table visually processes that the action skipped them
            setTimeout(() => {
                const checkGame = games[gameId];
                if (checkGame && checkGame.seats[checkGame.actionSeat] === actingToken && checkGame.players[actingToken].isDisconnected) {
                    const foldResult = checkGame.playerAction(actingToken, 'fold', 0);
                    if (foldResult && !foldResult.error) processGameResult(gameId, foldResult);
                }
            }, 1500); 
        }
    }
  }

  function processGameResult(gameId, result) {
    const game = games[gameId];
    if (!game) return;
    
    clearClock(game, gameId); 

    if (result.phase === 'showdown' || result.phase === 'game_over') {
      if (result.results) {
         result.results.forEach(pot => {
            const winners = pot.players.map(p => p.name).join(' & ');
            const handType = pot.handName ? `- ${pot.handName}` : '- Uncontested';
            io.to(gameId).emit('chat', { system: true, msg: `📜 HISTORY: ${winners} won Hand #${game.handCount} ${handType} (${pot.pot} Chips)` });
         });
      }

      if (result.results && result.results.systemChat) {
        result.results.systemChat.forEach(msg => {
          io.to(gameId).emit('chat', { system: true, msg });
        });
      }
      
      io.to(gameId).emit('showdown', result);
      broadcastState(gameId);
      
      if (result.phase === 'game_over') {
         if (game.blindTimer) { clearInterval(game.blindTimer); game.blindTimer = null; }
         io.to(gameId).emit('chat', { system: true, msg: `🏆 ${result.tournamentWinner.name} IS THE CHAMPION 🏆` });
      } else {
         startNextHandTimeout(gameId, 8000, true); 
      }
    } else {
      broadcastState(gameId);
      checkAutoFold(gameId); // Check if we landed on an offline player
    }
  }

  function checkStartBlindTimer(game, gameId) {
    if (game.gameType !== 'tournament' || game.blindTimer) return;
    game.blindTimer = setInterval(() => {
        if (game.currentBlindLevel < game.blindLevels.length - 1) {
            game.currentBlindLevel++;
            game.smallBlind = game.blindLevels[game.currentBlindLevel].sb;
            game.bigBlind = game.blindLevels[game.currentBlindLevel].bb;
            io.to(gameId).emit('chat', { system: true, msg: `⚠️ TOURNAMENT UPDATE: Blinds have increased to ${game.smallBlind}/${game.bigBlind}` });
            broadcastState(gameId);
        }
    }, game.blindLevelDuration * 60 * 1000);
  }

  function startNextHandTimeout(gameId, delay = 8000, override = false) {
    const g = games[gameId];
    if (!g) return;
    
    if (g.nextHandTimer && !override) return; 

    if (g.nextHandTimer) clearTimeout(g.nextHandTimer);
    
    g.nextHandTimer = setTimeout(() => {
      g.nextHandTimer = null; 
      const active = g.getActivePlayers().filter(p => p.chips > 0 || (p.chips === 0 && p.isActive));
      
      if (active.length >= 2 && (g.phase === 'waiting' || g.phase === 'showdown')) {
        const r = g.startHand();
        if (!r.error) {
          io.to(gameId).emit('hand_started', { dealerSeat: r.dealerSeat });
          broadcastState(gameId);
          checkAutoFold(gameId); // Check if the SB/BB/First-to-act is offline
        }
      } else if (g.phase === 'showdown') {
        g.phase = 'waiting';
        g.isContested = false; 
        broadcastState(gameId);
      }
    }, delay); 
  }

  socket.on('join_game', ({ gameId, name, avatarId, asSpectator, token }) => {
    const game = games[gameId];
    if (!game) { socket.emit('error', 'Game not found'); return; }

    if (asSpectator) {
      game.addSpectator(token, name);
      socket.join(gameId);
      socketMap[socket.id] = { gameId, token, isSpectator: true };
      socket.emit('joined', { seat: null, spectator: true });
    } else {
      let isReconnect = false;
      
      if (game.players[token]) {
          isReconnect = true;
          game.players[token].isDisconnected = false;
          game.players[token].name = name; 
          game.players[token].avatarId = avatarId;
      } else {
          if (game.getActivePlayers().length >= game.maxPlayers) {
            socket.emit('error', 'Game is full'); return;
          }
          const result = game.addPlayer(token, name, avatarId);
          if (result.error) { socket.emit('error', result.error); return; }
      }

      // Kill the ghost room destruct timer if they saved the table!
      if (game.destroyTimer) {
          clearTimeout(game.destroyTimer);
          game.destroyTimer = null;
      }

      socket.join(gameId);
      socketMap[socket.id] = { gameId, token, isSpectator: false };
      socket.emit('joined', { seat: game.players[token].seat, spectator: false });
      
      io.to(gameId).emit('chat', { system: true, msg: `${name} ${isReconnect ? 'reconnected to' : 'joined'} the network` });
    }
    broadcastState(gameId);
  });

  socket.on('start_game', () => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = getGame(info.gameId);
    if (!game) return;
    if (game.nextHandTimer) clearTimeout(game.nextHandTimer); 

    if (!game.canStartGame()) { socket.emit('error', 'Need at least 2 active players with chips to start'); return; }
    
    checkStartBlindTimer(game, info.gameId);

    const result = game.startHand();
    if (result.error) { socket.emit('error', result.error); return; }
    io.to(info.gameId).emit('hand_started', { dealerSeat: result.dealerSeat });
    broadcastState(info.gameId);
    checkAutoFold(info.gameId); 
  });

  socket.on('restart_tournament', () => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = getGame(info.gameId);
    if (!game) return;
    if (game.blindTimer) { clearInterval(game.blindTimer); game.blindTimer = null; }
    clearClock(game, info.gameId);
    game.restartGame();
    io.to(info.gameId).emit('chat', { system: true, msg: 'SYSTEM: The Host has initialized a new Tournament cycle.' });
    broadcastState(info.gameId);
  });

  socket.on('call_clock', () => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = getGame(info.gameId);
    if (!game || game.phase === 'waiting' || game.phase === 'showdown' || game.phase === 'game_over') return;
    if (game.clockTimer) return; 

    game.clockSeconds = 60;
    io.to(info.gameId).emit('chat', { system: true, msg: `SYSTEM: The Host has called the clock. 60 seconds to act.` });
    io.to(info.gameId).emit('clock_tick', { seconds: game.clockSeconds, actionSeat: game.actionSeat });

    game.clockTimer = setInterval(() => {
      game.clockSeconds--;
      if (game.clockSeconds > 0) {
         io.to(info.gameId).emit('clock_tick', { seconds: game.clockSeconds, actionSeat: game.actionSeat });
      }
      if (game.clockSeconds <= 0) {
        clearClock(game, info.gameId);
        const activeToken = game.seats[game.actionSeat];
        if (activeToken) {
          const p = game.players[activeToken];
          const callAmt = Math.max(0, game.currentBet - p.bet);
          const forcedAction = callAmt === 0 ? 'check' : 'fold';
          io.to(info.gameId).emit('chat', { system: true, msg: `SYSTEM: Time expired. Auto-${forcedAction} applied for ${p.name}.` });
          const result = game.playerAction(activeToken, forcedAction, 0);
          if (!result.error) processGameResult(info.gameId, result);
        }
      }
    }, 1000);
  });

  socket.on('player_action', ({ action, amount }) => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = getGame(info.gameId);
    if (!game) return;
    
    if (game.seats[game.actionSeat] === info.token) clearClock(game, info.gameId);

    const result = game.playerAction(info.token, action, amount);
    if (result.error) { socket.emit('error', result.error); return; }

    processGameResult(info.gameId, result);
  });

  socket.on('rebuy', () => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = getGame(info.gameId);
    if (!game || !game.allowRebuy) return;
    const player = game.players[info.token];
    
    if (!player || player.chips > 0 || player.isBusted) return;
    if (game.maxRebuys !== -1 && player.rebuyCount >= game.maxRebuys) return;

    player.chips = game.rebuyAmount;
    player.rebuyCount++;
    player.isActive = true;
    io.to(info.gameId).emit('chat', { system: true, msg: `${player.name} manually rebought for ${game.rebuyAmount} chips` });
    
    if (game.phase === 'waiting' || game.phase === 'showdown') {
       startNextHandTimeout(info.gameId, 3000, false);
    }
    broadcastState(info.gameId);
  });

  socket.on('toggle_auto_rebuy', (val) => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = getGame(info.gameId);
    if (!game) return;
    const player = game.players[info.token];
    if (player) {
      player.autoRebuy = !!val;
      if (player.autoRebuy && player.chips === 0 && !player.isBusted && (game.phase === 'waiting' || game.phase === 'showdown')) {
        const canRebuy = game.allowRebuy && (game.maxRebuys === -1 || player.rebuyCount < game.maxRebuys);
        if (canRebuy) {
          player.chips = game.rebuyAmount;
          player.rebuyCount++;
          player.isActive = true;
          io.to(info.gameId).emit('chat', { system: true, msg: `${player.name} auto-rebought for ${game.rebuyAmount} chips` });
          startNextHandTimeout(info.gameId, 3000, false);
        }
      }
      broadcastState(info.gameId);
    }
  });

  socket.on('chat', ({ msg }) => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = getGame(info.gameId);
    if (!game) return;
    const player = game.players[info.token] || game.spectators[info.token];
    if (!player) return;
    // Pushes the exact token to frontend for perfect hologram targeting
    io.to(info.gameId).emit('chat', { name: player.name, msg, token: info.token });
  });

  socket.on('disconnect', () => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = getGame(info.gameId);
    if (!game) return;
    
    if (info.isSpectator) {
       delete game.spectators[info.token];
    } else {
       const player = game.players[info.token];
       if (player) {
           player.isDisconnected = true;
           io.to(info.gameId).emit('chat', { system: true, msg: `${player.name} lost connection (5G Drop)` });
           
           // Immediate Auto-Fold if they dropped while it was their turn
           if (game.phase !== 'waiting' && game.phase !== 'showdown' && game.phase !== 'game_over' && game.seats[game.actionSeat] === info.token) {
               clearClock(game, info.gameId);
               const result = game.playerAction(info.token, 'fold', 0);
               if (result) processGameResult(info.gameId, result);
           }
           
           // HOST MIGRATION
           if (game.hostToken === info.token) {
               const nextPlayer = Object.values(game.players).find(p => !p.isDisconnected);
               if (nextPlayer) {
                   game.hostToken = nextPlayer.id; 
                   io.to(info.gameId).emit('chat', { system: true, msg: `SYSTEM: Host privileges migrated to ${nextPlayer.name}` });
               }
           }
       }
    }

    // THE GHOST ROOM CHECK: Start a 5-minute timer if nobody is left in the building
    const anyConnected = Object.values(game.players).some(p => !p.isDisconnected);
    if (!anyConnected) {
        game.destroyTimer = setTimeout(() => {
            if (game.blindTimer) clearInterval(game.blindTimer);
            if (game.nextHandTimer) clearTimeout(game.nextHandTimer);
            clearClock(game, info.gameId);
            delete games[info.gameId];
            console.log(`Destroyed abandoned room: ${info.gameId}`);
        }, 5 * 60 * 1000); 
    }

    delete socketMap[socket.id];
    broadcastState(info.gameId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n♠ Kaos Theory Poker server running at http://localhost:${PORT}`);
});