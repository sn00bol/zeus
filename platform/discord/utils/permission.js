require('dotenv').config();

// Parse comma-separated OWNER_ID from environment variables
const ownerIds = process.env.OWNER_ID
    ? process.env.OWNER_ID.split(',').map(id => id.trim()).filter(id => id.length > 0)
    : [];

/**
 * Check if the given user ID belongs to one of the bot owners.
 * @param {string} userId
 * @returns {boolean}
 */
function isOwner(userId) {
    return ownerIds.includes(userId);
}

module.exports = {
    isOwner,
    ownerIds
};
