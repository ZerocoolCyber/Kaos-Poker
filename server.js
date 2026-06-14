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
  let currentGameId = null;

  function getGame() { return games[currentGameId]; }

  function broadcastState(gameId) {
    const game = games[gameId];
    if (!game) return;
    io.sockets.sockets.forEach((s) => {
      if (s.rooms.has(gameId)) s.emit('game_state', game.getRoomState(s.id));
    });
  }

  // TOURNAMENT BLIND ESCALATOR
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
      if (active.length >= 2 && g.phase === 'waiting') {
        const r = g.startHand();
        if (!r.error) {
          io.to(gameId).emit('hand_started', { dealerSeat: r.dealerSeat });
          broadcastState(gameId);
        }
      }
    }, delay); 
  }

  socket.on('join_game', ({ gameId, name, avatarId, asSpectator }) => {
    const game = games[gameId];
    if (!game) { socket.emit('error', 'Game not found'); return; }

    if (asSpectator) {
      game.addSpectator(socket.id, name);
      socket.join(gameId);
      currentGameId = gameId;
      socket.emit('joined', { seat: null, spectator: true });
    } else {
      if (game.getActivePlayers().length >= game.maxPlayers) {
        socket.emit('error', 'Game is full'); return;
      }
      const result = game.addPlayer(socket.id, name, avatarId);
      if (result.error) { socket.emit('error', result.error); return; }
      socket.join(gameId);
      currentGameId = gameId;
      socket.emit('joined', { seat: result.seat, spectator: false });
    }

    if (!asSpectator) {
        io.to(gameId).emit('chat', { system: true, msg: `${name} joined the network` });
    }
    broadcastState(gameId);
  });

  socket.on('start_game', () => {
    const game = getGame();
    if (!game) return;
    if (game.nextHandTimer) clearTimeout(game.nextHandTimer); 

    if (!game.canStartGame()) { socket.emit('error', 'Need at least 2 active players with chips to start'); return; }
    
    // Kick off the blind escalator on the first hand
    checkStartBlindTimer(game, currentGameId);

    const result = game.startHand();
    if (result.error) { socket.emit('error', result.error); return; }
    io.to(currentGameId).emit('hand_started', { dealerSeat: result.dealerSeat });
    broadcastState(currentGameId);
  });

  socket.on('restart_tournament', () => {
    const game = getGame();
    if (!game) return;
    if (game.blindTimer) { clearInterval(game.blindTimer); game.blindTimer = null; }
    game.restartGame();
    io.to(currentGameId).emit('chat', { system: true, msg: 'SYSTEM: The Host has initialized a new Tournament cycle.' });
    broadcastState(currentGameId);
  });

  socket.on('player_action', ({ action, amount }) => {
    const game = getGame();
    if (!game) return;
    const result = game.playerAction(socket.id, action, amount);
    if (result.error) { socket.emit('error', result.error); return; }

    if (result.phase === 'showdown' || result.phase === 'game_over') {
      if (result.results && result.results.systemChat) {
        result.results.systemChat.forEach(msg => {
          io.to(currentGameId).emit('chat', { system: true, msg });
        });
      }
      io.to(currentGameId).emit('showdown', result);
      broadcastState(currentGameId);
      
      if (result.phase === 'game_over') {
         if (game.blindTimer) { clearInterval(game.blindTimer); game.blindTimer = null; }
         io.to(currentGameId).emit('chat', { system: true, msg: `🏆 ${result.tournamentWinner.name} IS THE CHAMPION 🏆` });
      } else {
         startNextHandTimeout(currentGameId, 8000, true); 
      }
    } else {
      broadcastState(currentGameId);
    }
  });

  socket.on('rebuy', () => {
    const game = getGame();
    if (!game || !game.allowRebuy) return;
    const player = game.players[socket.id];
    
    if (!player || player.chips > 0 || player.isBusted) return;
    if (game.maxRebuys !== -1 && player.rebuyCount >= game.maxRebuys) return;

    player.chips = game.rebuyAmount;
    player.rebuyCount++;
    player.isActive = true;
    io.to(currentGameId).emit('chat', { system: true, msg: `${player.name} manually rebought for ${game.rebuyAmount} chips` });
    
    if (game.phase === 'waiting') {
       startNextHandTimeout(currentGameId, 3000, false);
    }
    broadcastState(currentGameId);
  });

  socket.on('toggle_auto_rebuy', (val) => {
    const game = getGame();
    if (!game) return;
    const player = game.players[socket.id];
    if (player) {
      player.autoRebuy = !!val;
      if (player.autoRebuy && player.chips === 0 && !player.isBusted && game.phase === 'waiting') {
        const canRebuy = game.allowRebuy && (game.maxRebuys === -1 || player.rebuyCount < game.maxRebuys);
        if (canRebuy) {
          player.chips = game.rebuyAmount;
          player.rebuyCount++;
          player.isActive = true;
          io.to(currentGameId).emit('chat', { system: true, msg: `${player.name} auto-rebought for ${game.rebuyAmount} chips` });
          startNextHandTimeout(currentGameId, 3000, false);
        }
      }
      broadcastState(currentGameId);
    }
  });

  socket.on('chat', ({ msg }) => {
    const game = getGame();
    if (!game) return;
    const player = game.players[socket.id] || game.spectators[socket.id];
    if (!player) return;
    io.to(currentGameId).emit('chat', { name: player.name, msg });
  });

  socket.on('disconnect', () => {
    if (!currentGameId) return;
    const game = games[currentGameId];
    if (!game) return;
    const player = game.players[socket.id];
    const name = player ? player.name : (game.spectators[socket.id] || {}).name;

    if (player && game.phase !== 'waiting' && game.phase !== 'showdown' && game.phase !== 'game_over' && game.seats[game.actionSeat] === socket.id) {
        const result = game.playerAction(socket.id, 'fold', 0);
        if (result && (result.phase === 'showdown' || result.phase === 'game_over')) {
            io.to(currentGameId).emit('showdown', result);
            if (result.phase === 'game_over') {
                 if (game.blindTimer) { clearInterval(game.blindTimer); game.blindTimer = null; }
                 io.to(currentGameId).emit('chat', { system: true, msg: `🏆 ${result.tournamentWinner.name} IS THE CHAMPION 🏆` });
            } else {
                 startNextHandTimeout(currentGameId, 8000, true);
            }
        }
    }

    game.removePlayer(socket.id);
    if (name && player) io.to(currentGameId).emit('chat', { system: true, msg: `${name} disconnected` });
    broadcastState(currentGameId);

    if (Object.keys(game.players).length === 0 && Object.keys(game.spectators).length === 0) {
      if (game.blindTimer) clearInterval(game.blindTimer);
      if (game.nextHandTimer) clearTimeout(game.nextHandTimer);
      delete games[currentGameId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n♠ Kaos Theory Poker server running at http://localhost:${PORT}`);
});