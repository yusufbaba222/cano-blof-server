@@ -1,7 +1,5 @@
// server.js
// Cano Blöf – Online oyun sunucusu (host ataması & isim tekilliği garantili)
// Çalıştır: node server.js
// Bağımlılık: express, ws (package.json'da olacak)
// Cano Blöf – 3 sabit odalı WS sunucusu (ROOM1, ROOM2, ROOM3)

const express = require('express');
const http = require('http');
@@ -10,16 +8,47 @@ const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const app = express();

// Kök sayfa: tarayıcıdan kontrol için
app.get('/', (_req, res) => {
  res.type('text/plain').send('Cano Blöf WS server is running.');
  res.type('text/plain').send('Cano Blöf WS server is running. Rooms: ROOM1, ROOM2, ROOM3');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ====== Oda/State ======
// ---- Sabit odalar
const ALLOWED_ROOMS = ['ROOM1', 'ROOM2', 'ROOM3'];

/**
 * room = {
 *  id, players:[{id,name,ws}], hostId, phase,
 *  order:[], turnIndex, starterId, hintRound,
 *  deckWords:[], secretWord, spyId,
 *  votesChoice: Map, votesPlayer: Map, result
 * }
 */
const rooms = Object.create(null);
for (const id of ALLOWED_ROOMS) {
  rooms[id] = makeEmptyRoom(id);
}

function makeEmptyRoom(id) {
  return {
    id,
    players: [],
    hostId: null,
    phase: 'lobby',
    order: [],
    turnIndex: 0,
    starterId: null,
    hintRound: 0,
    deckWords: [],
    secretWord: null,
    spyId: null,
    votesChoice: new Map(),
    votesPlayer: new Map(),
    result: null,
  };
}

const WORDS_POOL = [
  'elma','armut','masa','kalem','deniz','güneş','ay','yıldız','araba','otobüs',
@@ -29,7 +58,7 @@ const WORDS_POOL = [
  'korsan','şövalye','kalp','priz','lamba','perde','kanepe','ekran','klavye','fare'
];

// ====== Yardımcılar ======
// ---- yardımcılar
const safeSend = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };
const broadcast = (room, obj) => room.players.forEach(p => safeSend(p.ws, obj));
const getPlayer = (room, id) => room.players.find(p => p.id === id);
@@ -57,7 +86,7 @@ function publishState(roomId){
    starterId: room.starterId,
    turnOwner: turnOwner(room),
    hintRound: room.hintRound,
    result: room.result || null
    result: room.result || null,
  };
  broadcast(room, payload);
  if (room.phase === 'voteChoice') broadcast(room, { type: 'vote_choice_update', tally: choiceTally(room) });
@@ -138,7 +167,9 @@ function handleSpyGuess(room, fromId, guess){
  broadcast(room, { type: 'game_result', ...room.result });
}

// ====== WS ======
function norm(s){ return (s || '').trim().toLowerCase(); }

// ---- WS
wss.on('connection', (ws) => {
  let roomId = null;
  let playerId = null;
@@ -149,42 +180,35 @@ wss.on('connection', (ws) => {
    let msg={}; try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      roomId = (msg.roomId || 'ROOM1').toString().trim().toUpperCase();
      const wanted = (msg.roomId || 'ROOM1').toString().trim().toUpperCase();
      const name = (msg.name || 'Oyuncu').toString().trim() || 'Oyuncu';

      if (!rooms[roomId]) {
        rooms[roomId] = {
          id: roomId,
          players: [],
          hostId: null,
          phase: 'lobby',
          order: [],
          turnIndex: 0,
          starterId: null,
          hintRound: 0,
          deckWords: [],
          secretWord: null,
          spyId: null,
          votesChoice: new Map(),
          votesPlayer: new Map(),
          result: null
        };
      if (!ALLOWED_ROOMS.includes(wanted)) {
        safeSend(ws, { type: 'error', message: 'Geçersiz oda. Sadece ROOM1 / ROOM2 / ROOM3 kullanılabilir.' });
        try { ws.close(); } catch {}
        return;
      }
      const room = rooms[roomId];
      roomId = wanted;
      const room = rooms[roomId]; // zaten var (sabit oda)

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
@@ -267,12 +291,11 @@ wss.on('connection', (ws) => {
      }
    }

    if (room.players.length === 0) { delete rooms[roomId]; return; }
    // DİKKAT: Oda boşsa bile SİLME (sabit odalar)
    publishState(roomId);
  });
});

// ====== Sunucuyu başlat ======
server.listen(PORT, () => {
  console.log('WS server listening on', PORT);
});
