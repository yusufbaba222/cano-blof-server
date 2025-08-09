const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Yeni biri bağlandı');
  ws.send(JSON.stringify({ type: 'hello', text: 'Merhaba!' }));

  ws.on('message', (message) => {
    console.log('Mesaj:', message.toString());
  });

  ws.on('close', () => {
    console.log('Bağlantı kapandı');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server çalışıyor: ${PORT}`));
