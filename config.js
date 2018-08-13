'use strict';

/**
 * Module Dependencies
 */

var pkg               = require('./package.json');
var dotenv            = require('dotenv');
var path              = require('path');

// *For Development Purposes*
// Read in environment vars from .env file

dotenv.load();

/**
 * Configuration File
 *
 * Why like this?
 *
 *  - All environmental variables documented in one place
 *  - If I use "." notation it's easy to cut/paste into code
 *  - Unlike JSON, javascript allows comments (which I like)
 *  - Reading package.json here centralizes all config info
 *
 */

var config            = {};

// From package.json
config.name           = pkg.name;
config.version        = pkg.version;
config.description    = pkg.description;
config.company        = pkg.company;
config.author         = pkg.author;
config.keywords       = pkg.keywords;
config.environment    = process.env.NODE_ENV || 'development';

config.port = process.env.PORT || 3000;
config.root = process.env.ROOT_URL || ('http://localhost:' + config.port);

config.logging = false;

config.rateLimit = 100;

/**
 * Database Configuration
 */

config.redis          = {};
config.redis.host     = process.env.REDIS_HOST || '127.0.0.1';
config.redis.port     = process.env.REDIS_PORT || 6379;
config.redis.database = process.env.REDIS_DATABASE || 3;

/**
 * Remote logging configuration
 */
config.logging = true;

/**
 * Session Configuration
 */

var hour              = 3600000;
var day               = (hour * 24);
var week              = (day * 7);

module.exports = config;

