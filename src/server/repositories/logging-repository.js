/*jslint bitwise: true, node: true */
'use strict';

// Pulls in our modified cloud db client from sql.js
const dbClient = require("../sql.js");

const logFailedLoginAttempt = async (username, ipAddress) => {
    // PostgreSQL uses $1, $2 instead of SQLite's '?' syntax
    const query = `
        INSERT INTO failed_login_attempts (username, ip_address) 
        VALUES ($1, $2)
    `;
    const values = [username, ipAddress];

    try {
        // Run the query cleanly using async/await promises
        await dbClient.query(query, values);
    } catch (err) {
        console.error("[Plan B] Error inserting failed login log into RDS:", err);
    }
};

module.exports = {
    logFailedLoginAttempt,
};
