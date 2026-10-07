const { getCommandUser, replyToCommand, sendCommandMessage } = require('../utils/commandInteraction');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const packageInfo = require('../../../package.json');
require('dotenv').config();
const { getMenuRow, getPaginationRow, getOptions, applySelectMenuDefaults } = require('../utils/NavigateManager');
const { isOwner: isOwnerUser } = require('../utils/permission');
const { getSlashCommandValidationError } = require('../utils/slashCommand');

// In-memory fallback cache for category selection (used if DB is unavailable)
const lastHelpCategoriesByUser = new Map();

const isVisibleCommand = (cmd) => cmd?.show !== false;
const supportsDM = (cmd) => cmd?.DMs !== false;
const supportsSlash = (cmd) => !getSlashCommandValidationError(cmd);
const formatAliases = (cmd) => {
    if (!cmd?.aliases) return '';
    const aliasList = Array.isArray(cmd.aliases) ? cmd.aliases : [cmd.aliases];
    const normalized = aliasList.map(a => String(a).trim()).filter(Boolean);
    return normalized.length > 0 ? ` (aliases: ${normalized.map(a => '`' + a + '`').join(', ')})` : '';
};

module.exports = {
    name: 'help',
    aliases: ['h'],
    description: 'Display help commands and bot information',
    usage: 'Zhelp `command`',
    slashOptions: [
        { name: 'command', description: 'Show details for a specific command', type: 'string', required: false },
    ],
    async execute(message, args) {
        const { commands, aliases } = message.client;
        const commandName = message.isChatInputCommand?.()
            ? message.options.getString('command')
            : args?.[0];

        if (commandName) {
            const cmdName = commandName.toLowerCase();
            const command = commands.get(cmdName) || aliases.get(cmdName);
            if (!command) {
                const similar = commands.find(c => c.name.includes(cmdName) || cmdName.includes(c.name) || (Array.isArray(c.aliases) && c.aliases.some(a => a.includes(cmdName) || cmdName.includes(a))));
                if (similar) {
                    return replyToCommand(message, { content: `Not found command, do you mean \`${similar.name}\`?`, ephemeral: true });
                }
                return replyToCommand(message, { content: `Command not found.`, ephemeral: true });
            }
            const aliasText = formatAliases(command);
            const cmdEmbed = new EmbedBuilder()
                .setTitle(`**${command.name}**${aliasText}`)
                .addFields(
                    { name: 'Description', value: command.description || 'No description', inline: false },
                    { name: 'Usage', value: command.usage ? `${command.usage}` : `\`Z${command.name}\`` || 'No usage provided.', inline: false }
                );
            let notes = command.notes || '';
            if (notes) {
                cmdEmbed.addFields({ name: 'Important Notes', value: notes, inline: false });
            }
            return sendCommandMessage(message, { embeds: [cmdEmbed] });
        }

        let currentPage = 0;
        const itemsPerPage = 5;
        const isOwner = isOwnerUser(getCommandUser(message).id);

        // Load last-accessed categories from DB, fallback to in-memory or 'all'
        let currentCategories;
        try {
            const dbCategories = await message.client.db.getHelpPreference(getCommandUser(message).id);
            currentCategories = dbCategories;
        } catch {
            const memCategories = lastHelpCategoriesByUser.get(getCommandUser(message).id);
            currentCategories = Array.isArray(memCategories) && memCategories.length > 0
                ? [...memCategories]
                : ['all'];
        }

        // Filter commands based on category, ownership, and visibility
        const getFilteredCmds = (categories) => {
            return commands.filter(cmd => {
                if (!isVisibleCommand(cmd)) return false;

                // An owner-only command is one whose category is 'owner' or is an array containing only 'owner'
                const isOwnerOnly = Array.isArray(cmd.category)
                    ? (cmd.category.includes('owner') && cmd.category.every(cat => cat === 'owner'))
                    : cmd.category === 'owner';

                if (!isOwner && isOwnerOnly) return false;
                if (categories.includes('all')) return true;

                // Match if any of the command's categories are in the selected categories list
                if (Array.isArray(cmd.category)) {
                    return cmd.category.some(cat => categories.includes(cat));
                }
                return categories.includes(cmd.category);
            });
        };

        // Menu options — show Owner option only for bot owner
        const menuOptions = isOwner
            ? [...getOptions(), { label: 'Owner', value: 'owner' }]
            : getOptions();
        const maxVals = Math.max(1, menuOptions.length - 1);

        // Helper: build the full embed + components for a given state
        const buildPage = (categories, page) => {
            if (categories.includes('gau3')) {
                const updatedOptions = applySelectMenuDefaults(menuOptions, categories);
                const menuRow = getMenuRow('help_slt', updatedOptions, maxVals, 0);
                const embed = new EmbedBuilder()
                    .setTitle('🔧 Construction Area')
                    .setDescription('Architects are designing the house and interior for Santaa... what can you expect?');
                return { embed, components: [menuRow] };
            }

            const filteredArray = Array.from(getFilteredCmds(categories).values());
            const totalPages = Math.ceil(filteredArray.length / itemsPerPage);
            const start = page * itemsPerPage;
            const pagedCmds = filteredArray.slice(start, start + itemsPerPage);

            const displayContent = pagedCmds.map(cmd => {
                const prefix = cmd.folder === 'adminCMD' ? '🛡️ ' : '';
                const aliasText = formatAliases(cmd);
                const dmSupport = supportsDM(cmd) ? '✓' : '✗';
                const slashSupport = supportsSlash(cmd) ? '✓' : '✗';
                return `**${prefix}${cmd.name.toUpperCase()}** DM: ${dmSupport} · Slash: ${slashSupport}\n-# ${cmd.description || 'No description provided.'}`;
            }).join('\n\n') || 'No commands in this category.';

            const embed = new EmbedBuilder()
                .setTitle(`Commands\n> Try use Zhelp \`command\` for more information`)
                .setDescription(displayContent)
                .setFooter({ text: `Page ${page + 1} of ${totalPages || 1}` });

            const updatedOptions = applySelectMenuDefaults(menuOptions, categories);
            const menuRow = getMenuRow('help_slt', updatedOptions, maxVals, 0);
            const btnRow = getPaginationRow(page, totalPages);
            const components = filteredArray.length > itemsPerPage ? [menuRow, btnRow] : [menuRow];

            return { embed, components, totalPages };
        };

        // Initial render — directly shows commands without a separate welcome embed
        const { embed: initialEmbed, components: initialComponents } = buildPage(currentCategories, currentPage);
        const response = await sendCommandMessage(message, { embeds: [initialEmbed], components: initialComponents });

        // Component collector for menu and pagination
        const collector = response.createMessageComponentCollector({ time: 60000 });

        let currentMenuRow = initialComponents[0]; // keep track for end event

        collector.on('collect', async (i) => {
            if (i.user.id !== getCommandUser(message).id) return i.reply({ content: 'Not your menu!', ephemeral: true });

            if (i.isStringSelectMenu()) {
                const newSelection = i.values;

                if (newSelection.length === 0) {
                    currentCategories = ['all'];
                } else {
                    const exclusives = ['all', 'gau3'];
                    let newlySelectedExclusive = null;
                    for (const exc of exclusives) {
                        if (newSelection.includes(exc) && !currentCategories.includes(exc)) {
                            newlySelectedExclusive = exc;
                            break;
                        }
                    }

                    if (newlySelectedExclusive) {
                        currentCategories = [newlySelectedExclusive];
                    } else {
                        const hasOthers = newSelection.some(v => !exclusives.includes(v));
                        if (hasOthers) {
                            currentCategories = newSelection.filter(v => !exclusives.includes(v));
                        } else {
                            currentCategories = newSelection;
                        }
                    }
                }

                if (currentCategories.length === 0) currentCategories = ['all'];

                // Save to DB + in-memory fallback
                try {
                    await message.client.db.setHelpPreference(getCommandUser(message).id, [...currentCategories]);
                } catch {
                    // DB write failed, at least update in-memory
                }
                lastHelpCategoriesByUser.set(getCommandUser(message).id, [...currentCategories]);
                currentPage = 0;

            } else if (i.isButton()) {
                switch (i.customId) {
                    case 'prev': currentPage--; break;
                    case 'next': currentPage++; break;
                    case 'first': currentPage = 0; break;
                    case 'last': {
                        const totalItems = getFilteredCmds(currentCategories).size;
                        currentPage = Math.max(0, Math.ceil(totalItems / itemsPerPage) - 1);
                        break;
                    }
                }
            }

            const { embed: pageEmbed, components } = buildPage(currentCategories, currentPage);
            currentMenuRow = components[0];
            await i.update({ embeds: [pageEmbed], components });
        });

        collector.on('end', () => {
            currentMenuRow.components[0].setDisabled(true);
            response.edit({ components: [currentMenuRow] }).catch(() => { });
        });
    },
};