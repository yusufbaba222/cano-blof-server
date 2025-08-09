// server.js — Cano Blöf (3 sabit oda)
// Çalıştır: node server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const app = express();

app.get('/', (_req, res) => {
  res.type('text/plain').send('Cano Blöf WS server is running. Rooms: ROOM1, ROOM2, ROOM3');
});

// Oda özetleri: kişi sayısı + faz
app.get('/rooms', (_req, res) => {
  const out = {};
  for (const id of ALLOWED_ROOMS) {
    const r = rooms[id];
    out[id] = {
      count: r?.players?.length || 0,
      phase: r?.phase || 'lobby'
    };
  }
  res.json(out);
});


const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ---- Sabit odalar
const ALLOWED_ROOMS = ['ROOM1', 'ROOM2', 'ROOM3'];

const rooms = Object.create(null);
for (const id of ALLOWED_ROOMS) rooms[id] = makeEmptyRoom(id);

function makeEmptyRoom(id) {
  return {
    id,
    players: [],            // {id, name, ws}
    hostId: null,
    phase: 'lobby',         // 'lobby'|'hinting'|'voteChoice'|'votePlayer'|'spyGuess'|'end'
    order: [],
    turnIndex: 0,
    starterId: null,
    hintRound: 0,
    deckWords: [],
    secretWord: null,
    spyId: null,
    votesChoice: new Map(), // playerId -> 'player'|'round4'
    votesPlayer: new Map(), // playerId -> targetId
    result: null,           // {winner:'CIVIL'|'SPY', spyId, secretWord}
  };
}

const WORDS_POOL = [
  'elma','armut','masa','kalem','deniz','güneş','ay','yıldız','araba','otobüs',
  'harita','telefon','radyo','bilgisayar','kamera','sandalye','yazılım','bahar','kış','yaz',
  'bahçe','top','futbol','kitap','kağıt','kule','köprü','nehir','orman','bulut',
  'pencere','kapı','saat','çanta','bilet','turist','ada','uçak','tren','liman',
  'korsan','şövalye','kalp','priz','lamba','perde','kanepe','ekran','klavye','fare'
];

// ---- helpers
const safeSend = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };
const broadcast = (room, obj) => room.players.forEach(p => safeSend(p.ws, obj));
const getPlayer = (room, id) => room.players.find(p => p.id === id);
const norm = (s) => (s || '').trim().toLowerCase();
const rndId = () => Math.random().toString(36).slice(2,10);

function shuffle(a){ for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function pick(pool, n){ const t=[...pool]; shuffle(t); return t.slice(0, Math.max(1, Math.min(n, t.length))); }
const turnOwner = (room) => room.order.length ? room.order[room.turnIndex % room.order.length] : null;

function choiceTally(room){ let player=0, round4=0; room.votesChoice.forEach(v => { if (v==='player') player++; else if (v==='round4') round4++; }); return { player, round4 }; }
function playerTally(room){ const t={}; room.votesPlayer.forEach(id => { t[id]=(t[id]||0)+1; }); return t; }
const everyoneVotedChoice = (room) => room.players.every(p => room.votesChoice.has(p.id));
const everyoneVotedPlayer = (room) => room.players.every(p => room.votesPlayer.has(p.id));

function publishState(roomId){
  const room = rooms[roomId]; if (!room) return;
  broadcast(room, {
    type: 'state',
    phase: room.phase,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    order: room.order,
    hostId: room.hostId,
    starterId: room.starterId,
    turnOwner: turnOwner(room),
    hintRound: room.hintRound,
    result: room.result || null,
  });
  if (room.phase === 'voteChoice') broadcast(room, { type: 'vote_choice_update', tally: choiceTally(room) });
  if (room.phase === 'votePlayer') broadcast(room, { type: 'vote_player_update', tally: playerTally(room) });
}
function setPhase(room, next){ room.phase = next; broadcast(room, { type: 'phase_change', phase: next }); publishState(room.id); }

function setupRound(room){
  shuffle(room.order);
  room.turnIndex = 0;
  room.starterId = room.order[0] || null;
  room.hintRound = 1;
  room.result = null;

  // Roller
  const spyIdx = Math.floor(Math.random() * room.order.length);
  room.spyId = room.order[spyIdx] || null;

  // Kelime destesi + gizli kelime
  const deck = pick(WORDS_POOL, 20);
  room.deckWords = deck;
  room.secretWord = deck[Math.floor(Math.random() * deck.length)] || deck[0];

  // Dağıtım
  broadcast(room, { type: 'deal_start' });
  room.players.forEach(p => {
    if (p.id === room.spyId) safeSend(p.ws, { type: 'your_card', role: 'SPY', title: 'CASUS' });
    else safeSend(p.ws, { type: 'your_card', role: 'WORD', title: 'MASUM', words: deck });
  });

  setTimeout(() => {
    room.players.forEach(p => {
      if (p.id !== room.spyId) safeSend(p.ws, { type: 'secret_word', word: room.secretWord });
    });
  }, 400);

  broadcast(room, { type: 'round_started', you: null });
  setPhase(room, 'hinting');
}

function afterHint(room){
  room.turnIndex = (room.turnIndex + 1) % room.order.length;
  if (room.turnIndex === 0) {
    room.hintRound += 1;
    if (room.hintRound === 4) { room.votesChoice = new Map(); setPhase(room, 'voteChoice'); return; }
    if (room.hintRound === 5) { room.votesPlayer = new Map(); setPhase(room, 'votePlayer'); return; }
  }
  publishState(room.id);
}

function maybeResolveChoice(room){
  const t = choiceTally(room);
  broadcast(room, { type: 'vote_choice_update', tally: t });
  if (!everyoneVotedChoice(room)) return;
  if (t.round4 > t.player) setPhase(room, 'hinting'); else { room.votesPlayer = new Map(); setPhase(room, 'votePlayer'); }
}

function maybeResolvePlayer(room){
  const t = playerTally(room);
  broadcast(room, { type: 'vote_player_update', tally: t });
  if (!everyoneVotedPlayer(room)) return;

  let targetId=null, best=-1;
  Object.entries(t).forEach(([pid,c]) => { if (c>best){best=c; targetId=pid;} });
  if (!targetId) return;

  if (targetId === room.spyId) {
    room.result = { winner: 'CIVIL', spyId: room.spyId, secretWord: room.secretWord };
    setPhase(room, 'end');
    broadcast(room, { type: 'game_result', ...room.result });
  } else {
    setPhase(room, 'spyGuess');
  }
}

function handleSpyGuess(room, fromId, guess){
  if (fromId !== room.spyId) return;
  const ok = norm(guess) === norm(room.secretWord);
  room.result = { winner: ok ? 'SPY' : 'CIVIL', spyId: room.spyId, secretWord: room.secretWord };
  setPhase(room, 'end');
  broadcast(room, { type: 'game_result', ...room.result });
}

function norm(s){ return (s || '').trim().toLowerCase(); }

// ---- WS
wss.on('connection', (ws) => {
  let roomId = null;
  let playerId = null;

  safeSend(ws, { type: 'hello', you: null });

  ws.on('message', (raw) => {
    let msg={}; try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      const wanted = (msg.roomId || 'ROOM1').toString().trim().toUpperCase();
      const name = (msg.name || 'Oyuncu').toString().trim() || 'Oyuncu';

      // sadece sabit 3 oda
      if (!ALLOWED_ROOMS.includes(wanted)) {
        safeSend(ws, { type: 'error', message: 'Geçersiz oda. Sadece ROOM1 / ROOM2 / ROOM3.' });
        try { ws.close(); } catch {}
        return;
      }
      roomId = wanted;
      const room = rooms[roomId];

      // isim tekilliği
      if (room.players.find(p => norm(p.name) === norm(name))) {
        safeSend(ws, { type: 'error', message: 'Bu odada aynı isim zaten var. Lütfen başka bir isim deneyin.' });
        try { ws.close(); } catch {}
        return;
      }

      // ekle
      playerId = rndId();
      room.players.push({ id: playerId, name, ws });

      // host yoksa ata
      if (!room.hostId) room.hostId = playerId;

      // sıra dizisi
      room.order = room.players.map(p => p.id);

      // bildir
      safeSend(ws, { type: 'hello', you: playerId });
      publishState(roomId);
      return;
    }

    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];

    if (msg.type === 'start_round') {
      if (playerId !== room.hostId) return;
      if (!(room.phase === 'lobby' || room.phase === 'end')) return;
      if (room.players.length < 3) { safeSend(ws, { type: 'error', message: 'Round için en az 3 oyuncu gerekir.' }); return; }
      room.votesChoice = new Map();
      room.votesPlayer = new Map();
      setupRound(room);
      return;
    }

    if (msg.type === 'post_hint') {
      if (room.phase !== 'hinting') return;
      if (turnOwner(room) !== playerId) { safeSend(ws, { type: 'error', message: 'Sıra sende değil.' }); return; }
      const text = (msg.text || '').toString().trim().slice(0, 140);
      if (!text) return;
      broadcast(room, { type: 'hint_posted', by: playerId, text, round: room.hintRound });
      afterHint(room);
      return;
    }

    if (msg.type === 'vote_choice') {
      if (room.phase !== 'voteChoice') return;
      const choice = msg.choice === 'round4' ? 'round4' : 'player';
      room.votesChoice.set(playerId, choice);
      broadcast(room, { type: 'vote_choice_update', tally: choiceTally(room) });
      maybeResolveChoice(room);
      return;
    }

    if (msg.type === 'vote_player') {
      if (room.phase !== 'votePlayer') return;
      const target = (msg.target || '').toString();
      if (!getPlayer(room, target)) return;
      room.votesPlayer.set(playerId, target);
      broadcast(room, { type: 'vote_player_update', tally: playerTally(room) });
      maybeResolvePlayer(room);
      return;
    }

    if (msg.type === 'spy_guess') {
      if (room.phase !== 'spyGuess') return;
      const guess = (msg.word || '').toString().trim();
      if (!guess) return;
      handleSpyGuess(room, playerId, guess);
      return;
    }
  });

  ws.on('close', () => {
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;

    if (playerId) {
      room.players = room.players.filter(p => p.id !== playerId);

      if (room.hostId === playerId) {
        room.hostId = room.players[0]?.id || null;
      }

      if (room.order.includes(playerId)) {
        const idx = room.order.indexOf(playerId);
        room.order = room.order.filter(id => id !== playerId);
        if (idx <= room.turnIndex && room.turnIndex > 0) room.turnIndex -= 1;
        if (room.turnIndex >= room.order.length) room.turnIndex = 0;
      }

      if (playerId === room.spyId && !(room.phase === 'lobby' || room.phase === 'end')) {
        room.result = { winner: 'CIVIL', spyId: playerId, secretWord: room.secretWord };
        setPhase(room, 'end');
        broadcast(room, { type: 'game_result', ...room.result });
      }
    }

    // oda boşsa silme; sabit odalar
    if (room.players.length === 0) {
      room.hostId = null;
      room.phase = 'lobby';
      room.order = [];
      room.turnIndex = 0;
      room.starterId = null;
      room.hintRound = 0;
      room.deckWords = [];
      room.secretWord = null;
      room.spyId = null;
      room.votesChoice = new Map();
      room.votesPlayer = new Map();
      room.result = null;
      publishState(roomId);
      return;
    }

    publishState(roomId);
  });
});

server.listen(PORT, () => {
  console.log('WS server listening on', PORT);
});
