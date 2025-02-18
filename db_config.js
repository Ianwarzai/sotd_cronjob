const { Client } = require('pg');
require('dotenv').config();

const pool = new Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
  idleTimeoutMillis: 0,
  connectionTimeoutMillis: 0,
});

pool.connect().then(() => console.log("Database connected"));

async function createTables() {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      firstName VARCHAR(100) NOT NULL,
      lastName VARCHAR(100) NOT NULL,
      username VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      password VARCHAR(255) NOT NULL,
      email_verified BOOLEAN DEFAULT FALSE,
      verification_token VARCHAR(100),
      verification_expires TIMESTAMPTZ,
      stripe_customer_id VARCHAR(255),
      pass_reset_token VARCHAR(100),
      pass_reset_timesStamp VARCHAR(100),
      createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Keep existing tables...
  const createMembershipsTable = `
    CREATE TABLE IF NOT EXISTS memberships (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type VARCHAR(20) DEFAULT 'FREE',
      status VARCHAR(20) DEFAULT 'PENDING',
      start_date VARCHAR(255),
      end_date VARCHAR(255),
      stripe_customer_id VARCHAR(255),
      stripe_subscription_id VARCHAR(255),
      stripe_session_id VARCHAR(255),
      is_auto_renew BOOLEAN DEFAULT FALSE,
      createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `;

  const createUserAttemptsTable = `
    CREATE TABLE IF NOT EXISTS user_attempts (
      user_id INTEGER PRIMARY KEY,
      attempts INTEGER DEFAULT 3,
      reset_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `;

  const createStockHistory = `
  CREATE TABLE IF NOT EXISTS stock_history (
    id SERIAL PRIMARY KEY,
    stock_data JSONB,
    stock_type VARCHAR(100) NOT NULL,
    stock_day VARCHAR(100) NOT NULL,
    createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );
`;

const createTradingHistory = `
CREATE TABLE IF NOT EXISTS trading_history (
  id SERIAL PRIMARY KEY,
  trading_type VARCHAR(100) NOT NULL,
  trading_data JSONB,
  createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
`;

  try {
    await Promise.all([
      pool.query(createUsersTable),
      pool.query(createMembershipsTable),
      pool.query(createUserAttemptsTable),
      pool.query(createStockHistory),
      pool.query(createTradingHistory),
    ]);
    console.log("Tables created successfully.");
  } catch (err) {
    console.error("Error creating tables:", err);
  }
}

createTables();

module.exports = pool;