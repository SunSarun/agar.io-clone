/*jslint bitwise: true, node: true */
'use strict';

const { Client } = require('pg');
const config = require('../../config');

// --- PLAN B: CENTRAL CLOUD DATABASE INSTANTIATION ---
// Fallback to local configuration variables if AWS environment variables aren't injected yet
const dbClient = new Client({
  host: process.env.DB_HOST || config.sqlinfo.host || 'localhost',
  user: process.env.DB_USER || config.sqlinfo.user || 'postgres',
  password: process.env.DB_PASSWORD || config.sqlinfo.password || 'password',
  database: process.env.DB_NAME || config.sqlinfo.database || 'agarioclone',
  port: process.env.DB_PORT || 5432,
});

// Establish connection to your centralized database (e.g., Amazon RDS)
dbClient.connect()
  .then(() => {
    console.log('Connected to the centralized Cloud Database via PostgreSQL.');

    // Perform table migrations using modern SQL queries
    dbClient.query(`
      CREATE TABLE IF NOT EXISTS failed_login_attempts (
        username TEXT,
        ip_address TEXT
      )
    `).then(() => {
      console.log("Verified / Created failed_login_attempts table");
    }).catch(err => console.error("Error creating login table:", err));

    dbClient.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        username TEXT,
        message TEXT,
        ip_address TEXT,
        timestamp BIGINT
      )
    `).then(() => {
      console.log("Verified / Created chat_messages table");
    }).catch(err => console.error("Error creating chat table:", err));

  })
  .catch(err => {
    console.error('Failed to establish connection to Cloud Database:', err);
  });

// Graceful disconnection handling instead of standard process hooks
process.on('SIGINT', async () => {
  try {
    await dbClient.end();
    console.log('Closed the Cloud Database connection cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('Error closing database client connections:', err);
    process.exit(1);
  }
});

// Export the db client instance so chat-repository and log-repository can call queries
module.exports = dbClient;
