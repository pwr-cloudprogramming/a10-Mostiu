const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = {};
let games = {}; 
let userCredentials = {}; 


wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        console.log('Received message:', data);
        
        switch (data.type) {
            case 'sign_up':
                if (userCredentials[data.name]) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Nickname already taken' }));
                } else {
                    userCredentials[data.name] = data.password;
                    players[data.name] = ws;
                    ws.name = data.name;
                    console.log(`Player signed up: ${data.name}`);
                    broadcastPlayers();
                }
                break;
            case 'sign_in':
                if (userCredentials[data.name] && userCredentials[data.name] === data.password) {
                    players[data.name] = ws;
                    ws.name = data.name;
                    console.log(`Player signed in: ${data.name}`);
                    broadcastPlayers();
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid nickname or password' }));
                }
                break;
            case 'start_game':
                if (players[data.opponent]) {
                    const gameId = `${ws.name}-${data.opponent}`;
                    games[gameId] = {
                        board: Array(9).fill(null),
                        turn: ws.name,
                        players: [ws.name, data.opponent]
                    };
                    console.log(`Game started between ${ws.name} and ${data.opponent}`);
                    players[data.opponent].send(JSON.stringify({ type: 'game_start', opponent: ws.name, gameId }));
                    ws.send(JSON.stringify({ type: 'game_start', opponent: data.opponent, gameId }));
                } else {
                    console.log(`Opponent ${data.opponent} not found`);
                }
                break;
            case 'make_move':
                const game = games[data.gameId];
                if (game && game.turn === ws.name && game.board[data.index] === null) {
                    game.board[data.index] = ws.name;
                    if (checkWinner(game.board)) {
                        console.log(`Player ${ws.name} wins!`);
                        broadcastGameResult(game, ws.name);
                    } else if (game.board.every(cell => cell !== null)) {
                        console.log(`Game is a draw`);
                        broadcastGameResult(game, 'draw');
                    } else {
                        game.turn = game.players.find(p => p !== ws.name);
                        console.log(`Move made by ${ws.name} at index ${data.index}`);
                        broadcastGameUpdate(game);
                    }
                } else {
                    console.log(`Invalid move by ${ws.name} at index ${data.index}`);
                }
                break;
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected:', ws.name);
        delete players[ws.name];
        broadcastPlayers();
    });
});

function broadcastPlayers() {
    const playerList = Object.keys(players);
    console.log('Broadcasting players:', playerList);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'players', players: playerList }));
        }
    });
}

function broadcastGameUpdate(game) {
    console.log(`Broadcasting game update: ${game.players.join(' vs ')} - Board: ${game.board}`);
    game.players.forEach(player => {
        if (players[player]) {
            players[player].send(JSON.stringify({ type: 'game_update', game }));
        }
    });
}

function broadcastGameResult(game, result) {
    console.log(`Broadcasting game result: ${result}`);
    game.players.forEach(player => {
        if (players[player]) {
            players[player].send(JSON.stringify({ type: 'game_result', result }));
        }
    });
}

function checkWinner(board) {
    const winningCombinations = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],  // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8],  // Columns
        [0, 4, 8], [2, 4, 6]              // Diagonals
    ];

    return winningCombinations.some(combination => {
        const [a, b, c] = combination;
        return board[a] && board[a] === board[b] && board[a] === board[c];
    });
}



server.listen(8080, '0.0.0.0', () => {
    console.log('Server is listening on port 8080');
});
