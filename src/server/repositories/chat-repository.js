/*jslint bitwise: true, node: true */
'use strict';

// This pulls in our newly modified cloud db client from sql.js
const dbClient = require("../sql.js");

const logChatMessage = async (username, message, ipAddress) => {
    const timestamp = new Date().getTime();

    // PostgreSQL uses $1, $2, etc. instead of SQLite's '?' syntax
    const query = `
        INSERT INTO chat_messages (username, message, ip_address, timestamp) 
        VALUES ($1, $2, $3, $4)
    `;
    const values = [username, message, ipAddress, timestamp];

    try {
        // Await the query directly since the pg client natively returns promises
        await dbClient.query(query, values);
    } catch (err) {
        console.error("[Plan B] Error inserting chat message into RDS:", err);
    }
};

module.exports = {
    logChatMessage,
};
