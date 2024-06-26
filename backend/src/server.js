const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const AWS = require('aws-sdk');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

AWS.config.update({ region: 'us-east-1' });
const cognito = new AWS.CognitoIdentityServiceProvider();

app.use(bodyParser.json());
app.use(cors()); // Enable CORS for all routes

let players = {};
let games = {};

// Function to verify JWT token
const verifyToken = async (token) => {
    const jwksUrl = `https://cognito-idp.us-east-1.amazonaws.com/YOUR_USER_POOL_ID/.well-known/jwks.json`;
    const { data } = await axios.get(jwksUrl);
    const pems = {};
    data.keys.forEach(key => {
        pems[key.kid] = jwkToPem(key);
    });

    const decodedJwt = jwt.decode(token, { complete: true });

    if (!decodedJwt) {
        throw new Error('Not a valid JWT token');
    }

    const pem = pems[decodedJwt.header.kid];

    if (!pem) {
        throw new Error('Invalid token');
    }

    return new Promise((resolve, reject) => {
        jwt.verify(token, pem, { algorithms: ['RS256'] }, (err, payload) => {
            if (err) {
                reject(err);
            } else {
                resolve(payload);
            }
        });
    });
};

// Cognito sign-up endpoint
app.post('/signup', (req, res) => {
    const { username, password, email } = req.body;

    const params = {
        ClientId: 'YOUR_APP_CLIENT_ID', // Replace with your App Client ID
        Username: username,
        Password: password,
        UserAttributes: [
            {
                Name: 'email',
                Value: email
            }
        ]
    };

    cognito.signUp(params, (err, data) => {
        if (err) {
            console.log(err);
            res.status(500).json({ error: err.message });
        } else {
            res.json({ message: 'User signed up', data });
        }
    });
});

// Cognito verify endpoint
app.post('/verify', (req, res) => {
    const { username, code } = req.body;

    const params = {
        ClientId: 'YOUR_APP_CLIENT_ID', // Replace with your App Client ID
        Username: username,
        ConfirmationCode: code
    };

    cognito.confirmSignUp(params, (err, data) => {
        if (err) {
            console.log(err);
            res.status(500).json({ error: err.message });
        } else {
            res.json({ message: 'User verified', data });
        }
    });
});

// Cognito sign-in endpoint
app.post('/signin', (req, res) => {
    const { username, password } = req.body;

    const params = {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: 'YOUR_APP_CLIENT_ID', // Replace with your App Client ID
        AuthParameters: {
            USERNAME: username,
            PASSWORD: password
        }
    };

    cognito.initiateAuth(params, (err, data) => {
        if (err) {
            console.log(err);
            res.status(500).json({ error: err.message });
        } else {
            const { IdToken, AccessToken, RefreshToken } = data.AuthenticationResult;
            res.json({
                message: 'User signed in',
                tokens: {
                    IdToken,
                    AccessToken,
                    RefreshToken
                }
            });
        }
    });
});

// Cognito logoff endpoint
app.post('/logoff', (req, res) => {
    const { refreshToken } = req.body;

    const params = {
        Token: refreshToken,
        ClientId: 'YOUR_APP_CLIENT_ID' // Replace with your App Client ID
    };

    cognito.revokeToken(params, (err, data) => {
        if (err) {
            console.log(err);
            res.status(500).json({ error: err.message });
        } else {
            res.json({ message: 'User logged off and token invalidated' });
        }
    });
});

// WebSocket connection with token verification
wss.on('connection', async (ws, req) => {
    const token = req.url.split('?token=')[1];

    if (!token) {
        ws.close(1008, 'Token is required');
        return;
    }

    try {
        const payload = await verifyToken(token);
        console.log('Token verified', payload);

        ws.on('message', (message) => {
            const data = JSON.parse(message);
            console.log('Received message:', data);

            switch (data.type) {
                case 'sign_in':
                    players[data.name] = ws;
                    ws.name = data.name;
                    console.log(`Player signed in: ${data.name}`);
                    broadcastPlayers();
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

    } catch (error) {
        console.error('Token verification failed:', error);
        ws.close(1008, 'Invalid token');
    }
});

function broadcastPlayers() {
    const playerList = Object.keys(players).filter(player => players[player]);
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
            players[player].send(JSON.stringify({ type: 'game_result', result, board: game.board }));
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
