const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Knowledge = sequelize.define('Knowledge', {
    type: {
        type: DataTypes.STRING,
        allowNull: false
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false
    }
}, {
    tableName: 'knowledge',
    timestamps: true
});

module.exports = Knowledge;
