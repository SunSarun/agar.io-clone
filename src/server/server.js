/*jslint bitwise: true, node: true */
'use strict';

const express = require('express');
const app = express();
const http = require('http').Server(app);

// --- PLAN B: REDIS INTEGRATION ---
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const pubClient = createClient({ url: redisUrl });
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => console.error('[Redis Pub Client Error]', err));
subClient.on('error', (err) => console.error('[Redis Sub Client Error]', err));

Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
        console.log(`[Plan B] Connected to Redis cleanly at ${redisUrl}`);
    })
    .catch((err) => {
        console.error('[Plan B] Redis connection initialization error:', err);
    });

const io = require('socket.io')(http, {
    adapter: createAdapter(pubClient, subClient)
});
// --- END OF PLAN B MODIFICATION ---

const SAT = require('sat');
const gameLogic = require('./game-logic');
const loggingRepositry = require('./repositories/logging-repository');
const chatRepository = require('./repositories/chat-repository');
const config = require('../../config');
const util = require('./lib/util');
const mapUtils = require('./map/map');
const {getPosition} = require("./lib/entityUtils");

let map = new mapUtils.Map(config);

let sockets = {};
let spectators = [];
const INIT_MASS_LOG = util.mathLog(config.defaultPlayerMass, config.slowBase);

let leaderboard = [];
let leaderboardChanged = false;

const Vector = SAT.Vector;

app.use(express.static(__dirname + '/../client'));

io.on('connection', function (socket) {
    let type = socket.handshake.query.type;
    console.log('User has connected: ', type);
    switch (type) {
        case 'player':
            addPlayer(socket);
            break;
        case 'spectator':
            addSpectator(socket);
            break;
        default:
            console.log('Unknown user type, not doing anything.');
    }
});

function generateSpawnpoint() {
    let radius = util.massToRadius(config.defaultPlayerMass);
    return getPosition(config.newPlayerInitialPosition === 'farthest', radius, map.players.data)
}

// 💡 PROTOTYPE HARVESTER: Force-instantiate a dummy cell on boot to capture its internal methods
let verifiedCellPrototype = null;
try {
    const bootstrapPlayer = new mapUtils.playerUtils.Player('bootstrap-id');
    bootstrapPlayer.init({ x: 0, y: 0 }, config.defaultPlayerMass || 10);
    if (bootstrapPlayer.cells && bootstrapPlayer.cells[0]) {
        verifiedCellPrototype = Object.getPrototypeOf(bootstrapPlayer.cells[0]);
        console.log('[Setup] Cell engine prototype methods successfully cached.');
    }
} catch (e) {
    console.error('[Setup Error] Failed to harvest native cell prototype structure:', e);
}

// Deep hydration helper function to re-inflate nested cell properties and SAT Vectors
function hydratePlayer(pStr) {
    const rawData = JSON.parse(pStr);
    
    let playerInstance = new mapUtils.playerUtils.Player(rawData.id);
    Object.assign(playerInstance, rawData);
    
    if (rawData.cells && Array.isArray(rawData.cells)) {
        playerInstance.cells = rawData.cells.map(rawCell => {
            let cellInstance = {};
            if (verifiedCellPrototype) {
                Object.setPrototypeOf(cellInstance, verifiedCellPrototype);
            }
            Object.assign(cellInstance, rawCell);
            
            if (rawCell.x !== undefined && rawCell.y !== undefined) {
                cellInstance.x = rawCell.x;
                cellInstance.y = rawCell.y;
            }
            if (rawCell.target && typeof rawCell.target === 'object') {
                cellInstance.target = new Vector(rawCell.target.x, rawCell.target.y);
            }
            return cellInstance;
        });
    }

    if (rawData.target && typeof rawData.target === 'object') {
        playerInstance.target = new Vector(rawData.target.x, rawData.target.y);
    }

    return playerInstance;
}

const addPlayer = (socket) => {
    var currentPlayer = new mapUtils.playerUtils.Player(socket.id);

    socket.on('gotit', async function (clientPlayerData) {
        console.log('[INFO] Player ' + clientPlayerData.name + ' connecting!');
        currentPlayer.init(generateSpawnpoint(), config.defaultPlayerMass);

        try {
            const playerExists = await pubClient.hExists('game:users', socket.id);
            if (playerExists) {
                console.log('[INFO] Player ID is already connected globally, kicking.');
                socket.disconnect();
                return;
            }
        } catch (redisErr) {
            console.error('[Redis Error] Failed checking player existence hash:', redisErr);
        }

        if (!util.validNick(clientPlayerData.name)) {
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + clientPlayerData.name + ' connected!');
            sockets[socket.id] = socket;

            const sanitizedName = clientPlayerData.name.replace(/(<([^>]+)>)/ig, '');
            clientPlayerData.name = sanitizedName;

            currentPlayer.clientProvidedData(clientPlayerData);
            
            map.players.pushNew(currentPlayer);
            
            await pubClient.hSet('game:users', socket.id, JSON.stringify(currentPlayer))
                .catch(err => console.error('[Redis Error] Failed saving player data structural hash:', err));

            io.emit('playerJoin', { name: currentPlayer.name });
        }
    });

    socket.on('pingcheck', () => {
        socket.emit('pongcheck');
    });

    socket.on('windowResized', (data) => {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
    });

    socket.on('respawn', async () => {
        map.players.removePlayerByID(currentPlayer.id);
        await pubClient.hDel('game:users', currentPlayer.id).catch(() => {});

        socket.emit('welcome', currentPlayer, {
            width: config.gameWidth,
            height: config.gameHeight
        });
    });

    socket.on('disconnect', async () => {
        map.players.removePlayerByID(currentPlayer.id);
        await pubClient.hDel('game:users', currentPlayer.id).catch(() => {});
        socket.broadcast.emit('playerDisconnect', { name: currentPlayer.name });
    });

    socket.on('playerChat', (data) => {
        if (!data || !data.sender || !data.message) return;
        var _sender = data.sender.replace(/(<([^>]+)>)/ig, '');
        var _message = data.message.replace(/(<([^>]+)>)/ig, '');

        socket.broadcast.emit('serverSendPlayerChat', {
            sender: currentPlayer.name || _sender,
            message: _message.substring(0, 35)
        });
    });

    socket.on('0', async (target) => {
        currentPlayer.lastHeartbeat = new Date().getTime();
        
        let localMatch = map.players.data.find(p => p.id === socket.id);
        let basePlayer = localMatch || currentPlayer;

        if (target.x !== basePlayer.x || target.y !== basePlayer.y) {
            basePlayer.target = target;
            basePlayer.lastHeartbeat = currentPlayer.lastHeartbeat;
            await pubClient.hSet('game:users', socket.id, JSON.stringify(basePlayer)).catch(() => {});
        }
    });

    socket.on('1', function () {
        let localMatch = map.players.data.find(p => p.id === socket.id);
        if (!localMatch) return;
        const minCellMass = config.defaultPlayerMass + config.fireFood;
        for (let i = 0; i < localMatch.cells.length; i++) {
            if (localMatch.cells[i].mass >= minCellMass) {
                localMatch.changeCellMass(i, -config.fireFood);
                map.massFood.addNew(localMatch, i, config.fireFood);
            }
        }
    });

    socket.on('2', () => {
        let localMatch = map.players.data.find(p => p.id === socket.id);
        if (localMatch) {
            localMatch.userSplit(config.limitSplit, config.defaultPlayerMass);
        }
    });
}

const addSpectator = (socket) => {
    socket.on('gotit', function () {
        sockets[socket.id] = socket;
        spectators.push(socket.id);
        io.emit('playerJoin', { name: '' });
    });

    socket.emit("welcome", {}, {
        width: config.gameWidth,
        height: config.gameHeight
    });
}

const tickPlayer = (currentPlayer) => {

    if (currentPlayer.lastHeartbeat < new Date().getTime() - config.maxHeartbeatInterval) {

        if(sockets[currentPlayer.id]) {

            sockets[currentPlayer.id].emit('kick', 'Last heartbeat received over ' + config.maxHeartbeatInterval + ' ago.');

            sockets[currentPlayer.id].disconnect();

        }

    }


    currentPlayer.move(config.slowBase, config.gameWidth, config.gameHeight, INIT_MASS_LOG);


    const isEntityInsideCircle = (point, circle) => {

        return SAT.pointInCircle(new Vector(point.x, point.y), circle);

    };


    const canEatMass = (cell, cellCircle, cellIndex, mass) => {

        if (isEntityInsideCircle(mass, cellCircle)) {

            if (mass.id === currentPlayer.id && mass.speed > 0 && cellIndex === mass.num)

                return false;

            if (cell.mass > mass.mass * 1.1)

                return true;

        }

        return false;

    };


    const canEatVirus = (cell, cellCircle, virus) => {

        return virus.mass < cell.mass && isEntityInsideCircle(virus, cellCircle)

    }


    const cellsToSplit = [];

    for (let cellIndex = 0; cellIndex < currentPlayer.cells.length; cellIndex++) {

        const currentCell = currentPlayer.cells[cellIndex];

        const cellCircle = currentCell.toCircle();


        const eatenFoodIndexes = util.getIndexes(map.food.data, food => isEntityInsideCircle(food, cellCircle));

        const eatenMassIndexes = util.getIndexes(map.massFood.data, mass => canEatMass(currentCell, cellCircle, cellIndex, mass));

        const eatenVirusIndexes = util.getIndexes(map.viruses.data, virus => canEatVirus(currentCell, cellCircle, virus));


        if (eatenVirusIndexes.length > 0) {

            cellsToSplit.push(cellIndex);

            map.viruses.delete(eatenVirusIndexes)

        }


        let massGained = eatenMassIndexes.reduce((acc, index) => acc + map.massFood.data[index].mass, 0);


        map.food.delete(eatenFoodIndexes);

        map.massFood.remove(eatenMassIndexes);

        massGained += (eatenFoodIndexes.length * config.foodMass);

        currentPlayer.changeCellMass(cellIndex, massGained);

    }

    currentPlayer.virusSplit(cellsToSplit, config.limitSplit, config.defaultPlayerMass);

};


const tickGame = async () => {
    try {
        const rawUsers = await pubClient.hGetAll('game:users');
        const combinedPlayers = Object.values(rawUsers).map(hydratePlayer);
        
        map.players.data = combinedPlayers;
        
        // Map individual updates over asynchronous worker steps safely
        for (let player of map.players.data) {
            await tickPlayer(player);
        }
        
        map.massFood.move(config.gameWidth, config.gameHeight);

        map.players.handleCollisions(function (gotEaten, eater) {
            const cellGotEaten = map.players.getCell(gotEaten.playerIndex, gotEaten.cellIndex);
            if(!cellGotEaten) return;

            map.players.data[eater.playerIndex].changeCellMass(eater.cellIndex, cellGotEaten.mass);

            const playerDied = map.players.removeCell(gotEaten.playerIndex, gotEaten.cellIndex);
            if (playerDied) {
                let playerGotEaten = map.players.data[gotEaten.playerIndex];
                io.emit('playerDied', { name: playerGotEaten.name });
                if(sockets[playerGotEaten.id]) {
                    sockets[playerGotEaten.id].emit('RIP');
                    sockets[playerGotEaten.id].disconnect();
                }
                map.players.removePlayerByIndex(gotEaten.playerIndex);
                pubClient.hDel('game:users', playerGotEaten.id).catch(() => {});
            }
        });

        for (let player of map.players.data) {
            await pubClient.hSet('game:users', player.id, JSON.stringify(player)).catch(() => {});
        }
    } catch (err) {
        console.error('[Tick Error] Core tick orchestration failed:', err);
    }
};

const calculateLeaderboard = () => {
    const topPlayers = map.players.getTopPlayers();
    if (leaderboard.length !== topPlayers.length) {
        leaderboard = topPlayers;
        leaderboardChanged = true;
    } else {
        for (let i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].id !== topPlayers[i].id) {
                leaderboard = topPlayers;
                leaderboardChanged = true;
                break;
            }
        }
    }
}

const gameloop = () => {
    if (map.players.data.length > 0) {
        calculateLeaderboard();
        map.players.shrinkCells(config.massLossRate, config.defaultPlayerMass, config.minMassLoss);
    }
    map.balanceMass(config.foodMass, config.gameMass, config.maxFood, config.maxVirus);
};

const sendUpdates = async () => {
    try {
        const rawUsers = await pubClient.hGetAll('game:users');
        const unifiedPlayers = Object.values(rawUsers).map(hydratePlayer);

        map.players.data = unifiedPlayers;
        spectators.forEach(updateSpectator);

        map.enumerateWhatPlayersSee(function (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses) {
            if(sockets[playerData.id]) {
                sockets[playerData.id].emit('serverTellPlayerMove', playerData, unifiedPlayers, visibleFood, visibleMass, visibleViruses);
                if (leaderboardChanged) {
                    sendLeaderboard(sockets[playerData.id]);
                }
            }
        });

        leaderboardChanged = false;
    } catch (err) {
        console.error('[Network Sync Error] Render stream formatting exception encountered:', err);
    }
};

const sendLeaderboard = (socket) => {
    socket.emit('leaderboard', {
        players: map.players.data.length,
        leaderboard
    });
}

const updateSpectator = async (socketID) => {
    let playerData = {
        x: config.gameWidth / 2,
        y: config.gameHeight / 2,
        cells: [],
        massTotal: 0,
        hue: 100,
        id: socketID,
        name: ''
    };
    
    try {
        const rawUsers = await pubClient.hGetAll('game:users');
        const unifiedPlayers = Object.values(rawUsers).map(hydratePlayer);

        if(sockets[socketID]) {
            sockets[socketID].emit('serverTellPlayerMove', playerData, unifiedPlayers, map.food.data, map.massFood.data, map.viruses.data);
            if (leaderboardChanged) {
                sendLeaderboard(sockets[socketID]);
            }
        }
    } catch (err) {
        console.error('[Spectator Error] Could not compile shared update matrix for view client:', err);
    }
}

setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
http.listen(serverport, ipaddress, () => console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport));
