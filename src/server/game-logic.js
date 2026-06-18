/*jslint bitwise: true, node: true */
'use strict';

const config = require('../../config');
// Fix 1: Removed the accidental duplicate require('redlock') statement
const Redlock = require('redlock'); 
let redlock;                                                                                    
                                                                                                
function initRedlock(redisClient) {                                                             
    // Fix 2: Changed `new Redlock` to `new Redlock.default` or normal instantiation 
    // depending on your redlock version. For v5+, use: new Redlock([redisClient])
    redlock = new Redlock([redisClient], {
        driftFactor: 0.01, 
        retryCount: 0, // Don't retry; if another server has the lock, just skip this tick
        retryDelay: 200
    });
}

const adjustForBoundaries = (position, radius, borderOffset, gameWidth, gameHeight) => {
    const borderCalc = radius + borderOffset;
    if (position.x > gameWidth - borderCalc) {
        position.x = gameWidth - borderCalc;
    }
    if (position.y > gameHeight - borderCalc) {
        position.y = gameHeight - borderCalc;
    }
    if (position.x < borderCalc) {
        position.x = borderCalc;
    }
    if (position.y < borderCalc) {
        position.y = borderCalc;
    }
};

// This function must now be ASYNC because talking to Redis takes time across a network
async function updateAllPlayersPhysics(redisClient, gameWidth, gameHeight, borderOffset) {
    if (!redlock) initRedlock(redisClient);

    // 1. Try to get the physics lock for 15 milliseconds (roughly 1 frame at 60FPS)
    try {
        let lock = await redlock.acquire(['locks:game-physics'], 15);

        // 2. Fetch all player data structures out of the shared Redis Hash map
        const allUserData = await redisClient.hGetAll('game:users');
        
        // 3. Loop through every player found in the database
        for (const playerId of Object.keys(allUserData)) {
            let player = JSON.parse(allUserData[playerId]);

            // --- Apply the movement math ---
            // (Keep whatever velocity/direction math the original code used here)
            // player.position.x += player.velocity.x;
            // player.position.y += player.velocity.y;

            // 4. Run your stateless boundary checker function
            adjustForBoundaries(player.position, player.radius, borderOffset, gameWidth, gameHeight);

            // 5. Save the updated position straight back into Redis
            await redisClient.hSet('game:users', playerId, JSON.stringify(player));
        }

        // 6. Release the lock so the next server can process the next tick
        await lock.release();

    } catch (err) {
        // If we fail to acquire the lock, it means another EC2 instance in your ASG
        // is already processing this exact frame. We safely skip this tick.
    }
}

module.exports = {
    adjustForBoundaries,
    updateAllPlayersPhysics
};
