require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, AttachmentBuilder, Partials } = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

// Variables d'environnement
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TOKEN || !CLIENT_ID || !OWNER_ID || !GEMINI_API_KEY) {
    console.error("❌ Variables d'environnement manquantes !");
    process.exit(1);
}

const ai = new GoogleGenerativeAI(GEMINI_API_KEY);

const invitesCache = new Map();
const inviteDatabase = new Map();
const warnsDatabase = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildInvites
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

let ticketStats = { opened: 0, closed: 0 };
let activeProno = null;

const joinerInviter = new Map();
const TARIFS = { pdp: 1, minia: 1, banniere: 1, render: 0.5, overlay: 0.5 };

const CURRENCY_NAME = 'ESKY Coins';
const CURRENCY_EMOJI = '🪙';
let DAILY_AMOUNT = 50;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const economyDatabase = new Map();
const dailyCooldown = new Map();

function getBalance(userId) {
    if (!economyDatabase.has(userId)) economyDatabase.set(userId, 0);
    return economyDatabase.get(userId);
}

function addBalance(userId, amount) {
    const current = getBalance(userId);
    economyDatabase.set(userId, Math.max(0, current + amount));
    return economyDatabase.get(userId);
}

const SHOP_ITEMS = [
    { id: 'reduc10', name: 'Réduction 10%', emoji: '🎟️', price: 500, description: '10% de réduction sur ton prochain /devis' },
    { id: 'reduc20', name: 'Réduction 20%', emoji: '🎫', price: 900, description: '20% de réduction sur ton prochain /devis' },
    { id: 'prio', name: 'Ticket prioritaire', emoji: '⚡', price: 300, description: 'Fait passer un de tes tickets en priorité' }
];

const inventoryDatabase = new Map();

function getInventory(userId) {
    if (!inventoryDatabase.has(userId)) inventoryDatabase.set(userId, { reduc10: 0, reduc20: 0, prio: 0 });
    return inventoryDatabase.get(userId);
}

const reactionRoles = new Map();
const faqDatabase = new Map();
const ticketLastActivity = new Map();
const ticketReminded = new Set();

const DATA_FILE = path.join(__dirname, 'data.json');

function saveData() {
    const data = {
        inviteDatabase: Object.fromEntries(inviteDatabase),
        warnsDatabase: Object.fromEntries(warnsDatabase),
        economyDatabase: Object.fromEntries(economyDatabase),
        inventoryDatabase: Object.fromEntries(inventoryDatabase),
        dailyCooldown: Object.fromEntries(dailyCooldown),
        joinerInviter: Object.fromEntries(joinerInviter),
        ticketStats,
        reactionRoles: Object.fromEntries(reactionRoles),
        faqDatabase: Object.fromEntries(faqDatabase)
    };
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return;
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data.inviteDatabase || {})) inviteDatabase.set(k, v);
        for (const [k, v] of Object.entries(data.warnsDatabase || {})) warnsDatabase.set(k, v);
        for (const [k, v] of Object.entries(data.economyDatabase || {})) economyDatabase.set(k, v);
        for (const [k, v] of Object.entries(data.inventoryDatabase || {})) inventoryDatabase.set(k, v);
        for (const [k, v] of Object.entries(data.dailyCooldown || {})) dailyCooldown.set(k, v);
        for (const [k, v] of Object.entries(data.joinerInviter || {})) joinerInviter.set(k, v);
        if (data.ticketStats) ticketStats = data.ticketStats;
        for (const [k, v] of Object.entries(data.reactionRoles || {})) reactionRoles.set(k, v);
        for (const [k, v] of Object.entries(data.faqDatabase || {})) faqDatabase.set(k, v);
    } catch (e) {}
}

loadData();
setInterval(saveData, 2 * 60 * 1000);
process.on('SIGINT', () => { saveData(); process.exit(0); });
process.on('SIGTERM', () => { saveData(); process.exit(0); });

function getUserInviteData(userId) {
    if (!inviteDatabase.has(userId)) inviteDatabase.set(userId, { joins: 0, leaves: 0, fake: 0, bonus: 0 });
    return inviteDatabase.get(userId);
}

function getWarnHistory(userId) {
    if (!warnsDatabase.has(userId)) warnsDatabase.set(userId, []);
    return warnsDatabase.get(userId);
}

const commands = [
    new SlashCommandBuilder().setName('tarifs').setDescription('Affiche l\'image de mes tarifs officiels de graphisme'),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations et statistiques détaillées du serveur'),
    new SlashCommandBuilder().setName('payer').setDescription('Affiche le lien PayPal officiel pour régler vos commandes dzn'),
    new SlashCommandBuilder().setName('reseaux').setDescription('Affiche tous mes réseaux officiels (YouTube, X, Instagram)'),
    new SlashCommandBuilder().setName('prono-lancer').setDescription('Lance un pronostic (style Twitch)').addStringOption(opt => opt.setName('question').setDescription('La question').setRequired(true)).addStringOption(opt => opt.setName('option1').setDescription('Option 1').setRequired(true)).addStringOption(opt => opt.setName('option2').setDescription('Option 2').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('prono-fin').setDescription('Clôture le prono en cours et distribue les gains').addIntegerOption(opt => opt.setName('gagnant').setDescription('1 ou 2').setRequired(true).setMinValue(1).setMaxValue(2)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('parier').setDescription('Place ton pari sur le prono en cours').addIntegerOption(opt => opt.setName('choix').setDescription('1 ou 2').setRequired(true).setMinValue(1).setMaxValue(2)).addIntegerOption(opt => opt.setName('montant').setDescription('Montant de coins').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('admin-servers').setDescription('👑 [Owner] Liste de tous les serveurs du bot').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('invites').setDescription('Affiche vos stats d\'invitations').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(false)),
    new SlashCommandBuilder().setName('add-bonus').setDescription('Ajoute des invites bonus').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(opt => opt.setName('nombre').setDescription('Nombre').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages').addIntegerOption(opt => opt.setName('nombre').setDescription('Nombre').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder().setName('setup-ticket').setDescription('Panneau de ticket').addChannelOption(opt => opt.setName('salon').setDescription('Salon').setRequired(true)).addStringOption(opt => opt.setName('titre').setDescription('Titre').setRequired(true)).addStringOption(opt => opt.setName('description').setDescription('Desc').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('warn').setDescription('Warn un membre').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(true)).addStringOption(opt => opt.setName('raison').setDescription('Raison').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('portfolio').setDescription('Découvre mon portfolio Behance en ligne'),
    new SlashCommandBuilder().setName('annonce').setDescription('Envoie une annonce personnalisée').addChannelOption(opt => opt.setName('salon').setDescription('Salon').setRequired(true)).addStringOption(opt => opt.setName('titre').setDescription('Titre').setRequired(true)).addStringOption(opt => opt.setName('message').setDescription('Message').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder().setName('devis').setDescription('Calcule le prix total de ta commande').addIntegerOption(opt => opt.setName('pdp').setDescription('PDP').setRequired(false).setMinValue(0)).addIntegerOption(opt => opt.setName('minia').setDescription('Miniature').setRequired(false).setMinValue(0)).addIntegerOption(opt => opt.setName('banniere').setDescription('Banniere').setRequired(false).setMinValue(0)).addIntegerOption(opt => opt.setName('render').setDescription('Render').setRequired(false).setMinValue(0)).addIntegerOption(opt => opt.setName('overlay').setDescription('Overlay').setRequired(false).setMinValue(0)).addStringOption(opt => opt.setName('reduction').setDescription('Reduction').setRequired(false).addChoices({ name: 'Réduction 10%', value: 'reduc10' }, { name: 'Réduction 20%', value: 'reduc20' })),
    new SlashCommandBuilder().setName('ticket-stats').setDescription('Stats des tickets').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('leaderboard-invites').setDescription('Classement invites'),
    new SlashCommandBuilder().setName('mute').setDescription('Mute un membre').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(opt => opt.setName('minutes').setDescription('Minutes').setRequired(true).setMinValue(1)).addStringOption(opt => opt.setName('raison').setDescription('Raison').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('unmute').setDescription('Unmute un membre').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('historique').setDescription('Historique warns').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('unwarn').setDescription('Retire un warn').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('lock').setDescription('Verrouille le salon').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('unlock').setDescription('Déverrouille le salon').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('balance').setDescription('Affiche ton solde coins').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(false)),
    new SlashCommandBuilder().setName('daily').setDescription('Récompense quotidienne coins'),
    new SlashCommandBuilder().setName('pay').setDescription('Transfère des coins').addUserOption(opt => opt.setName('membre').setDescription('Destinataire').setRequired(true)).addIntegerOption(opt => opt.setName('montant').setDescription('Montant').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('leaderboard-eco').setDescription('Classement coins'),
    new SlashCommandBuilder().setName('add-coins').setDescription('Ajoute/retire des coins').addUserOption(opt => opt.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(opt => opt.setName('montant').setDescription('Montant').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('shop').setDescription('Boutique coins'),
    new SlashCommandBuilder().setName('buy').setDescription('Achète un article').addStringOption(opt => { opt.setName('objet').setDescription('Objet').setRequired(true); SHOP_ITEMS.forEach(i => opt.addChoices({ name: `${i.name} (${i.price})`, value: i.id })); return opt; }),
    new SlashCommandBuilder().setName('inventaire').setDescription('Inventaire objets'),
    new SlashCommandBuilder().setName('ticket-prioritaire').setDescription('Passe un ticket en prioritaire'),
    new SlashCommandBuilder().setName('add-role-reaction').setDescription('Rôles par réaction').addChannelOption(opt => opt.setName('salon').setDescription('Salon').setRequired(true)).addStringOption(opt => opt.setName('texte').setDescription('Texte').setRequired(true)).addStringOption(opt => opt.setName('emoji1').setDescription('Emoji 1').setRequired(true)).addRoleOption(opt => opt.setName('role1').setDescription('Rôle 1').setRequired(true)).addStringOption(opt => opt.setName('emoji2').setDescription('Emoji 2').setRequired(false)).addRoleOption(opt => opt.setName('role2').setDescription('Rôle 2').setRequired(false)).addStringOption(opt => opt.setName('emoji3').setDescription('Emoji 3').setRequired(false)).addRoleOption(opt => opt.setName('role3').setDescription('Rôle 3').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('faq-add').setDescription('Ajoute FAQ').addStringOption(opt => opt.setName('question').setDescription('Q').setRequired(true)).addStringOption(opt => opt.setName('reponse').setDescription('R').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('faq-remove').setDescription('Supprime FAQ').addStringOption(opt => opt.setName('question').setDescription('Q').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('faq').setDescription('Affiche FAQ').addStringOption(opt => opt.setName('question').setDescription('Q').setRequired(false)),
    new SlashCommandBuilder().setName('rappel-ticket').setDescription('Rappel ticket inactif')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
    console.log(`🤖 Connecté en tant que ${client.user.tag}!`);
    
    // Bulle de statut personnalisée
    client.user.setActivity('🤖 BOT perso ESKY', { type: 4 });

    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Commandes synchronisées !');
    } catch (error) { console.error(error); }

    for (const [, guild] of client.guilds.cache) {
        try {
            const guildInvites = await guild.invites.fetch();
            invitesCache.set(guild.id, new Map(guildInvites.map(inv => [inv.code, inv.uses])));
        } catch (e) {}
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options, guild, user } = interaction;

        if (commandName === 'serverinfo') {
            await guild.members.fetch().catch(() => {});
            
            const owner = await guild.fetchOwner().catch(() => null);
            const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
            const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
            const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size;
            const rolesCount = guild.roles.cache.size - 1;
            const botsCount = guild.members.cache.filter(m => m.user.bot).size;
            const humansCount = guild.memberCount - botsCount;
            const totalBoosts = guild.premiumSubscriptionCount || 0;
            const boostTier = guild.premiumTier || 0;
            const creationTimestamp = Math.floor(guild.createdTimestamp / 1000);

            const serverEmbed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle(`📊 Informations détaillées : ${guild.name}`)
                .setThumbnail(guild.iconURL({ dynamic: true, size: 1024 }))
                .addFields(
                    { name: '👑 Propriétaire', value: owner ? `<@${owner.id}>` : 'Inconnu', inline: true },
                    { name: '🆔 ID du serveur', value: `\`${guild.id}\``, inline: true },
                    { name: '📅 Création', value: `<t:${creationTimestamp}:F> (<t:${creationTimestamp}:R>)`, inline: false },
                    { name: `👥 Membres (${guild.memberCount})`, value: `👤 Humains : \`${humansCount}\`\n🤖 Bots : \`${botsCount}\``, inline: true },
                    { name: `📁 Salons (${guild.channels.cache.size})`, value: `💬 Textuels : \`${textChannels}\`\n🔊 Vocaux : \`${voiceChannels}\`\n📂 Catégories : \`${categories}\``, inline: true },
                    { name: '💎 Boosts & Niveau', value: `Niveau \`${boostTier}\` (${totalBoosts} boosts)`, inline: true },
                    { name: '🛡️ Sécurité & Rôles', value: `Niveau de vérification : \`${guild.verificationLevel}\`\nRôles total : \`${rolesCount}\``, inline: true }
                )
                .setFooter({ text: `Demandé par ${user.username}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            if (guild.bannerURL()) {
                serverEmbed.setImage(guild.bannerURL({ size: 1024 }));
            }

            return interaction.reply({ embeds: [serverEmbed] });
        }

        if (commandName === 'reseaux') {
            const reseauxEmbed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle('🌐 Mes Réseaux Officiels')
                .setDescription('Retrouve l\'ensemble de mes plateformes et abonne-toi pour ne rien rater :')
                .addFields(
                    { name: '📺 YouTube Principal', value: '[Clique ici](https://www.youtube.com/@ESKY_officiel/featured)', inline: false },
                    { name: '🎥 YouTube Secondaire', value: '[Clique ici](https://www.youtube.com/@ESKY_OFF)', inline: false },
                    { name: '🐦 X (Twitter)', value: '[Clique ici](https://x.com/YOUTUBE_ESKY)', inline: false },
                    { name: '📸 Instagram', value: '[Clique ici](https://www.instagram.com/esky.youtube)', inline: false }
                )
                .setTimestamp();

            const rowReseaux = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('YouTube 1').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/@ESKY_officiel/featured').setEmoji('📺'),
                new ButtonBuilder().setLabel('YouTube 2').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/@ESKY_OFF').setEmoji('🎥'),
                new ButtonBuilder().setLabel('X (Twitter)').setStyle(ButtonStyle.Link).setURL('https://x.com/YOUTUBE_ESKY').setEmoji('🩵'),
                new ButtonBuilder().setLabel('Instagram').setStyle(ButtonStyle.Link).setURL('https://www.instagram.com/esky.youtube').setEmoji('📸')
            );

            return interaction.reply({ embeds: [reseauxEmbed], components: [rowReseaux] });
        }

        if (commandName === 'prono-lancer') {
            if (activeProno) return interaction.reply({ content: '❌ Un pronostic est déjà en cours ! Termine-le avant d\'en lancer un autre.', ephemeral: true });
            const question = options.getString('question');
            const opt1 = options.getString('option1');
            const opt2 = options.getString('option2');

            activeProno = {
                question,
                options: [opt1, opt2],
                bets: new Map(),
                status: 'open'
            };

            const pronoEmbed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle('🔮 NOUVEAU PRONOSTIC !')
                .setDescription(`**${question}**\n\n1️⃣ **${opt1}**\n2️⃣ **${opt2}**\n\n*Utilise la commande \`/parier\` pour miser tes coins !*`)
                .setTimestamp();

            const rowProno = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bet_1').setLabel(`Parier sur : ${opt1}`).setStyle(ButtonStyle.Primary).setEmoji('1️⃣'),
                new ButtonBuilder().setCustomId('bet_2').setLabel(`Parier sur : ${opt2}`).setStyle(ButtonStyle.Primary).setEmoji('2️⃣')
            );

            const msg = await interaction.reply({ embeds: [pronoEmbed], components: [rowProno], fetchReply: true });
            activeProno.messageId = msg.id;
            return;
        }

        if (commandName === 'prono-fin') {
            if (!activeProno || activeProno.status !== 'open') return interaction.reply({ content: '❌ Aucun pronostic actif.', ephemeral: true });
            const winnerOpt = options.getInteger('gagnant');
            activeProno.status = 'closed';

            let totalPotOpt1 = 0;
            let totalPotOpt2 = 0;
            const winners = [];

            for (const [userId, data] of activeProno.bets.entries()) {
                if (data.choice === 1) totalPotOpt1 += data.amount;
                else totalPotOpt2 += data.amount;
            }

            const winningPot = winnerOpt === 1 ? totalPotOpt1 : totalPotOpt2;
            const losingPot = winnerOpt === 1 ? totalPotOpt2 : totalPotOpt1;
            const totalPot = winningPot + losingPot;

            for (const [userId, data] of activeProno.bets.entries()) {
                if (data.choice === winnerOpt) {
                    winners.push({ userId, amount: data.amount });
                }
            }

            let resultatTexte = `🏆 **Résultat du Pronostic !**\nOption gagnante : **${activeProno.options[winnerOpt - 1]}**\n\n`;
            resultatTexte += `💰 Pot total : \`${totalPot} 🪙\` (Gagnants : \`${winningPot}\` | Perdants : \`${losingPot}\`)\n\n`;

            if (winners.length === 0) {
                resultatTexte += `❌ Aucun gagnant n'a parié sur la bonne option. Le pot est perdu !`;
            } else if (losingPot === 0) {
                winners.forEach(w => addBalance(w.userId, w.amount));
                resultatTexte += `♻️ Personne n'a parié sur l'équipe adverse. Les mises ont été remboursées intégralement.`;
            } else {
                winners.forEach(w => {
                    const share = w.amount / winningPot;
                    const profitFromLosers = Math.floor(losingPot * share);
                    const totalWin = w.amount + profitFromLosers;
                    
                    addBalance(w.userId, totalWin);
                    resultatTexte += `• <@${w.userId}> récupère sa mise et gagne **+${profitFromLosers} 🪙 de bénéfice** (Total reçu : \`${totalWin} 🪙\`) !\n`;
                });
            }

            const finEmbed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle('🔮 CLÔTURE DU PRONOSTIC')
                .setDescription(resultatTexte)
                .setTimestamp();

            activeProno = null;
            return interaction.reply({ embeds: [finEmbed] });
        }

        if (commandName === 'parier') {
            if (!activeProno || activeProno.status !== 'open') return interaction.reply({ content: '❌ Aucun pronostic actif.', ephemeral: true });
            const choix = options.getInteger('choix');
            const montant = options.getInteger('montant');
            const userId = user.id;

            if (activeProno.bets.has(userId)) return interaction.reply({ content: '❌ Tu as déjà parié sur ce pronostic !', ephemeral: true });
            if (getBalance(userId) < montant) return interaction.reply({ content: '❌ Tu n\'as pas assez de coins !', ephemeral: true });

            addBalance(userId, -montant);
            activeProno.bets.set(userId, { choice: choix, amount: montant });
            return interaction.reply({ content: `✅ Pari enregistré de **${montant} 🪙** sur **${activeProno.options[choix - 1]}** !`, ephemeral: true });
        }

        if (commandName === 'portfolio') {
            const portfolioEmbed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle('🎨 Portfolio ESKY')
                .setDescription('Découvre l\'ensemble de mes créations graphiques sur mon portfolio officiel :')
                .addFields({ name: '🔗 Lien Behance', value: '[ESKY Graph - Graphiste in Belgium :: Behance](https://www.behance.net/esky_graph)' })
                .setTimestamp();
            const rowPortfolio = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Voir mon Behance').setStyle(ButtonStyle.Link).setURL('https://www.behance.net/esky_graph').setEmoji('🎨')
            );
            return interaction.reply({ embeds: [portfolioEmbed], components: [rowPortfolio] });
        }

        if (commandName === 'annonce') {
            const salon = options.getChannel('salon');
            const titre = options.getString('titre');
            const texte = options.getString('message').replace(/\\n/g, '\n');
            if (salon.type !== ChannelType.GuildText) return interaction.reply({ content: '❌ Salon textuel requis.', ephemeral: true });
            const annonceEmbed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle(titre)
                .setDescription(texte)
                .setFooter({ text: `Annonce par ${user.username}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
            await salon.send({ embeds: [annonceEmbed] });
            return interaction.reply({ content: `✅ Annonce postée dans ${salon} !`, ephemeral: true });
        }

        if (commandName === 'devis') {
            const quantities = {
                pdp: options.getInteger('pdp') || 0,
                minia: options.getInteger('minia') || 0,
                banniere: options.getInteger('banniere') || 0,
                render: options.getInteger('render') || 0,
                overlay: options.getInteger('overlay') || 0
            };
            const sousTotal = Object.entries(quantities).reduce((sum, [key, qty]) => sum + qty * TARIFS[key], 0);
            if (sousTotal === 0) return interaction.reply({ content: '❌ Précise au moins un service.', ephemeral: true });
            const lignes = Object.entries(quantities).filter(([, qty]) => qty > 0).map(([key, qty]) => `🔵 ${key.charAt(0).toUpperCase() + key.slice(1)} x${qty} — \`${(qty * TARIFS[key]).toFixed(2)} €\``).join('\n');
            const reductionChoisie = options.getString('reduction');
            let total = sousTotal;
            let reductionLigne = '';
            if (reductionChoisie) {
                const inventaire = getInventory(user.id);
                if (inventaire[reductionChoisie] > 0) {
                    const pourcentage = reductionChoisie === 'reduc20' ? 0.20 : 0.10;
                    const montantReduit = sousTotal * pourcentage;
                    total = sousTotal - montantReduit;
                    inventaire[reductionChoisie] -= 1;
                    reductionLigne = `\n🎟️ Réduction appliquée (-${(pourcentage * 100).toFixed(0)}%) : \`-${montantReduit.toFixed(2)} €\``;
                } else {
                    reductionLigne = `\n⚠️ Tu ne possèdes pas cette réduction.`;
                }
            }
            const devisEmbed = new EmbedBuilder()
                .setColor('#00ff44')
                .setTitle('🧾 Devis ESKY')
                .setDescription(lignes + reductionLigne)
                .addFields({ name: 'Total', value: `\`${total.toFixed(2)} €\`` })
                .setTimestamp();
            return interaction.reply({ embeds: [devisEmbed] });
        }

        if (commandName === 'ticket-stats') {
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('📊 Stats des tickets').addFields(
                { name: '📩 Ouverts', value: `\`${ticketStats.opened}\``, inline: true },
                { name: '✅ Fermés', value: `\`${ticketStats.closed}\``, inline: true },
                { name: '🔓 En cours', value: `\`${ticketStats.opened - ticketStats.closed}\``, inline: true }
            )], ephemeral: true });
        }

        if (commandName === 'leaderboard-invites') {
            const ranking = [...inviteDatabase.entries()].map(([userId, data]) => ({ userId, total: data.joins + data.bonus - data.leaves - data.fake })).sort((a, b) => b.total - a.total).slice(0, 10);
            if (ranking.length === 0) return interaction.reply({ content: '📭 Aucune invite.', ephemeral: true });
            const medailles = ['🥇', '🥈', '🥉'];
            const lignes = ranking.map((e, i) => `${medailles[i] || `**${i + 1}.**`} <@${e.userId}> — \`${e.total}\``).join('\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#e67e22').setTitle('🏆 Classement invites').setDescription(lignes)] });
        }

        if (commandName === 'mute') {
            const target = options.getMember('membre');
            const mins = options.getInteger('minutes');
            const r = options.getString('raison') || 'Aucune';
            await target.timeout(mins * 60 * 1000, r);
            return interaction.reply(`🔇 ${target} mute pour \`${mins}\` min.`);
        }

        if (commandName === 'unmute') {
            const target = options.getMember('membre');
            await target.timeout(null);
            return interaction.reply(`🔊 ${target} unmute.`);
        }

        if (commandName === 'historique') {
            const target = options.getUser('membre');
            const h = getWarnHistory(target.id);
            if (h.length === 0) return interaction.reply({ content: '✅ Aucun warn.', ephemeral: true });
            const lignes = h.map((w, i) => `**${i + 1}.** ${w.reason} — *par ${w.moderator}*`).join('\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#e74c3c').setTitle(`📋 Warns de ${target.username}`).setDescription(lignes)], ephemeral: true });
        }

        if (commandName === 'unwarn') {
            const target = options.getUser('membre');
            const h = getWarnHistory(target.id);
            if (h.length === 0) return interaction.reply({ content: '❌ Aucun warn.', ephemeral: true });
            h.pop();
            return interaction.reply(`✅ Dernier warn retiré.`);
        }

        if (commandName === 'lock') {
            await interaction.channel.permissionOverwrites.edit(guild.id, { SendMessages: false });
            return interaction.reply('🔒 Salon verrouillé.');
        }

        if (commandName === 'unlock') {
            await interaction.channel.permissionOverwrites.edit(guild.id, { SendMessages: null });
            return interaction.reply('🔓 Salon déverrouillé.');
        }

        if (commandName === 'balance') {
            const target = options.getUser('membre') || user;
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle(`${CURRENCY_EMOJI} Solde`).setDescription(`**${getBalance(target.id)} ${CURRENCY_NAME}**`)] });
        }

        if (commandName === 'daily') {
            const last = dailyCooldown.get(user.id);
            const now = Date.now();
            if (last && (now - last) < DAILY_COOLDOWN_MS) {
                return interaction.reply({ content: `⏳ Déjà récupéré ! Reviens plus tard.`, ephemeral: true });
            }
            dailyCooldown.set(user.id, now);
            const nb = addBalance(user.id, DAILY_AMOUNT);
            return interaction.reply(`${CURRENCY_EMOJI} **+${DAILY_AMOUNT} ${CURRENCY_NAME}** ! Solde : \`${nb}\`.`);
        }

        if (commandName === 'pay') {
            const target = options.getUser('membre');
            const montant = options.getInteger('montant');
            if (target.id === user.id) return interaction.reply({ content: '❌ Impossible.', ephemeral: true });
            if (getBalance(user.id) < montant) return interaction.reply({ content: '❌ Solde insuffisant.', ephemeral: true });
            addBalance(user.id, -montant);
            addBalance(target.id, montant);
            return interaction.reply(`${CURRENCY_EMOJI} Transfert réussi de **${montant} ${CURRENCY_NAME}** à ${target} !`);
        }

        if (commandName === 'leaderboard-eco') {
            const ranking = [...economyDatabase.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
            if (ranking.length === 0) return interaction.reply({ content: '📭 Personne n\'a de coins.', ephemeral: true });
            const medailles = ['🥇', '🥈', '🥉'];
            const lignes = ranking.map(([id, s], i) => `${medailles[i] || `**${i + 1}.**`} <@${id}> — \`${s}\` ${CURRENCY_NAME}`).join('\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle(`${CURRENCY_EMOJI} Classement`).setDescription(lignes)] });
        }

        if (commandName === 'add-coins') {
            const target = options.getUser('membre');
            const nb = addBalance(target.id, options.getInteger('montant'));
            return interaction.reply(`${CURRENCY_EMOJI} Nouveau solde pour ${target} : \`${nb}\`.`);
        }

        if (commandName === 'shop') {
            const lignes = SHOP_ITEMS.map(i => `${i.emoji} **${i.name}** — \`${i.price} ${CURRENCY_EMOJI}\`\n${i.description}`).join('\n\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#f1c40f').setTitle(`${CURRENCY_EMOJI} Boutique`).setDescription(lignes)] });
        }

        if (commandName === 'buy') {
            const item = SHOP_ITEMS.find(i => i.id === options.getString('objet'));
            if (getBalance(user.id) < item.price) return interaction.reply({ content: '❌ Solde insuffisant.', ephemeral: true });
            addBalance(user.id, -item.price);
            getInventory(user.id)[item.id] += 1;
            return interaction.reply(`✅ Achat réussi de **${item.name}** !`);
        }

        if (commandName === 'inventaire') {
            const inv = getInventory(user.id);
            const possede = SHOP_ITEMS.filter(i => inv[i.id] > 0);
            if (possede.length === 0) return interaction.reply({ content: '📭 Inventaire vide.', ephemeral: true });
            const lignes = possede.map(i => `${i.emoji} **${i.name}** x${inv[i.id]}`).join('\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle('🎒 Inventaire').setDescription(lignes)], ephemeral: true });
        }

        if (commandName === 'ticket-prioritaire') {
            if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: '❌ Dans un ticket uniquement.', ephemeral: true });
            const inv = getInventory(user.id);
            if (inv.prio <= 0) return interaction.reply({ content: '❌ Aucun ticket prioritaire en stock.', ephemeral: true });
            inv.prio -= 1;
            await interaction.channel.setName(`urgent-${interaction.channel.name.replace('ticket-', '')}`).catch(() => {});
            return interaction.reply('⚡ Ticket passé en **PRIORITAIRE** !');
        }

        if (commandName === 'add-role-reaction') {
            await interaction.deferReply({ ephemeral: true });
            const ch = options.getChannel('salon');
            const sent = await ch.send({ content: options.getString('texte') });
            const bindings = [];
            for (let n = 1; n <= 3; n++) {
                const em = options.getString(`emoji${n}`);
                const r = options.getRole(`role${n}`);
                if (em && r) {
                    await sent.react(em).catch(() => {});
                    bindings.push({ emoji: em, roleId: r.id });
                }
            }
            reactionRoles.set(sent.id, bindings);
            return interaction.editReply('✅ Rôles-réactions configurés !');
        }

        if (commandName === 'faq-add') {
            faqDatabase.set(options.getString('question').toLowerCase(), { question: options.getString('question'), reponse: options.getString('reponse') });
            return interaction.reply({ content: '✅ FAQ ajoutée.', ephemeral: true });
        }

        if (commandName === 'faq-remove') {
            faqDatabase.delete(options.getString('question').toLowerCase());
            return interaction.reply({ content: '✅ FAQ supprimée.', ephemeral: true });
        }

        if (commandName === 'faq') {
            const q = options.getString('question');
            if (q) {
                const match = [...faqDatabase.values()].find(f => f.question.toLowerCase().includes(q.toLowerCase()));
                if (!match) return interaction.reply({ content: '❌ Non trouvé.', ephemeral: true });
                return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`❓ ${match.question}`).setDescription(match.reponse)] });
            }
            if (faqDatabase.size === 0) return interaction.reply({ content: '📭 FAQ vide.', ephemeral: true });
            const lignes = [...faqDatabase.values()].map(f => `**${f.question}**\n${f.reponse}`).join('\n\n');
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('❓ FAQ').setDescription(lignes)] });
        }

        if (commandName === 'rappel-ticket') {
            ticketReminded.add(interaction.channel.id);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#f39c12').setTitle('🔔 Rappel').setDescription('Ce ticket est toujours en attente.')] });
        }

        if (commandName === 'admin-servers') {
            if (user.id !== OWNER_ID) return interaction.reply({ content: "❌ Réservé au owner.", ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            let text = "";
            for (const [id, g] of client.guilds.cache) {
                text += `🏠 **${g.name}** (\`${id}\`) — ${g.memberCount} membres\n`;
            }
            return user.send({ embeds: [new EmbedBuilder().setTitle('👑 Serveurs').setDescription(text)] }).then(() => interaction.editReply('✅ Envoyé en MP !'));
        }

        if (commandName === 'tarifs') {
            const tarifsPath = path.join(__dirname, 'tarifs.png');
            if (!fs.existsSync(tarifsPath)) return interaction.reply({ content: '❌ Image `tarifs.png` introuvable.', ephemeral: true });
            const attachment = new AttachmentBuilder(tarifsPath, { name: 'tarifs.png' });
            const embed = new EmbedBuilder().setColor('#00ff44').setTitle('🎨 ESKY PRICE V3').setImage('attachment://tarifs.png').setTimestamp();
            return interaction.reply({ embeds: [embed], files: [attachment] });
        }

        if (commandName === 'payer') {
            return interaction.reply({
                embeds: [new EmbedBuilder().setColor('#00457C').setTitle('💳 Paiement PayPal').setDescription('Règlement sécurisé :')],
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Payer via PayPal').setStyle(ButtonStyle.Link).setURL('https://paypal.me/ESKYgraphime'))]
            });
        }

        if (commandName === 'invites') {
            const target = options.getUser('membre') || user;
            const data = getUserInviteData(target.id);
            const total = data.joins + data.bonus - data.leaves - data.fake;
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`📈 ${target.username}`).setDescription(`Total : **${total}** invitations réelles`)] });
        }

        if (commandName === 'add-bonus') {
            getUserInviteData(options.getUser('membre').id).bonus += options.getInteger('nombre');
            return interaction.reply('✅ Bonus mis à jour.');
        }

        if (commandName === 'setup-ticket') {
            const ch = options.getChannel('salon');
            await ch.send({
                embeds: [new EmbedBuilder().setTitle(options.getString('titre')).setDescription(options.getString('description'))],
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket').setLabel('Commander').setStyle(ButtonStyle.Primary))]
            });
            return interaction.reply({ content: '✅ Panneau de ticket créé.', ephemeral: true });
        }

        if (commandName === 'clear') {
            await interaction.channel.bulkDelete(options.getInteger('nombre'), true);
            return interaction.reply({ content: '✅ Messages supprimés.', ephemeral: true });
        }

        if (commandName === 'warn') {
            const target = options.getMember('membre');
            const h = getWarnHistory(target.id);
            h.push({ reason: options.getString('raison') || 'Aucune', moderator: user.username, timestamp: Math.floor(Date.now() / 1000) });
            return interaction.reply(`⚠️ ${target} averti (${h.length}/3).`);
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'open_ticket') {
            const guild = interaction.guild;
            const user = interaction.user;
            await interaction.deferReply({ ephemeral: true });
            try {
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewCategory] },
                        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                    ]
                });
                ticketStats.opened += 1;
                ticketLastActivity.set(ticketChannel.id, Date.now());
                await ticketChannel.send({
                    embeds: [new EmbedBuilder().setColor('#00ff44').setTitle('🎨 Salon de commande').setDescription(`Bonjour ${user}, explique ton projet ici.`)],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setLabel('Payer via PayPal').setStyle(ButtonStyle.Link).setURL('https://paypal.me/ESKYgraphime'),
                            new ButtonBuilder().setCustomId('close_ticket').setLabel('Fermer le ticket').setStyle(ButtonStyle.Danger)
                        )
                    ]
                });
                return interaction.editReply({ content: `✅ Ton ticket : <#${ticketChannel.id}>` });
            } catch (e) {
                return interaction.editReply({ content: '❌ Erreur de création de ticket.' });
            }
        }

        if (interaction.customId === 'close_ticket') {
            await interaction.deferReply();
            ticketStats.closed += 1;
            await interaction.editReply({ content: '🔒 Fermeture du ticket...' });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }

        if (interaction.customId === 'bet_1' || interaction.customId === 'bet_2') {
            if (!activeProno || activeProno.status !== 'open') return interaction.reply({ content: '❌ Ce pronostic est terminé.', ephemeral: true });
            const choice = interaction.customId === 'bet_1' ? 1 : 2;
            return interaction.reply({ content: `💬 Pour parier sur **${activeProno.options[choice - 1]}**, tape \`/parier choix:${choice} montant:[ton_montant]\``, ephemeral: true });
        }
    }
});

client.login(TOKEN);