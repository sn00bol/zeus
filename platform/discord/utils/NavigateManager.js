const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const getOptions = () => {
    // Help.js
    const options = [
        { label: 'All', value: 'all', description: 'View all available commands' },
    ];
    options.push({ label: 'Unknown', value: 'gau3' });
    return options;
};

// Select Options
const getMenuRow = (customId, customOptions = null, maxValues = 1, minValues = 1) => {
    const options = customOptions || getOptions();
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder('Select a category')
            .setMinValues(minValues)
            .setMaxValues(maxValues)
            .addOptions(options)
    );
};

const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const createFastNavigateModal = (totalPages, customId = 'fast_navigate_modal') => {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle('Fast Navigate')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('page_input')
                    .setLabel(`Enter a page from 1 to ${totalPages}`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(`1 - ${totalPages}`)
                    .setRequired(true)
                    .setMinLength(1)
                    .setMaxLength(String(totalPages).length)
            )
        );
};

    const getReloadButton = (customId = 'reload', disabled = false) => {
        return new ButtonBuilder()
            .setCustomId(customId)
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled);
    };

const getPaginationRow = (currentPage, totalPages, options = {}) => {
    const includeFastNavigate = options.includeFastNavigate || false;
        const includeReload = options.includeReload || false;

    const components = [
        new ButtonBuilder()
            .setCustomId('first')
            .setEmoji('⏮')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('prev')
            .setEmoji('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
    ];

    if (includeFastNavigate) {
        components.push(
            new ButtonBuilder()
                .setCustomId('fast_navigate')
                .setEmoji('⏩')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(totalPages <= 1)
        );
    }

    if (includeReload) {
        components.push(getReloadButton(options.reloadCustomId || 'reload'));
    }

    components.push(
        new ButtonBuilder()
            .setCustomId('next')
            .setEmoji('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1 || totalPages === 0),
        new ButtonBuilder()
            .setCustomId('last')
            .setEmoji('⏭')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1 || totalPages === 0)
    );

    return new ActionRowBuilder().addComponents(components);
};

const applySelectMenuDefaults = (options, selectedValues) => {
    if (!selectedValues) return options;
    const selectedArray = Array.isArray(selectedValues) ? selectedValues : [selectedValues];
    return options.map(opt => ({
        ...opt,
        default: selectedArray.includes(opt.value)
    }));
};

module.exports = { getOptions, getMenuRow, getPaginationRow, getReloadButton, applySelectMenuDefaults, createFastNavigateModal };
