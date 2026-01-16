"use strict";
/**
 * Slack Integration - Cloud Functions
 * Handles incoming Slack webhooks and syncs messages to hConnect
 * Credentials are stored per-server in Firestore
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSlackChannels = exports.slackOAuth = exports.slackWebhook = void 0;
exports.syncHConnectMessageToSlack = syncHConnectMessageToSlack;
exports.syncHConnectThreadMessageToSlack = syncHConnectThreadMessageToSlack;
exports.syncHConnectReactionToSlack = syncHConnectReactionToSlack;
const firebase_functions_1 = require("firebase-functions");
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("./firebase");
const firestore_1 = require("firebase-admin/firestore");
const crypto = __importStar(require("crypto"));
// In-memory cache for Slack users (refresh every hour)
const slackUserCache = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const THREAD_DEFAULT_TTL_HOURS = 24;
const THREAD_MAX_MEMBER_LIMIT = 20;
const THREAD_ARCHIVE_MAX_HOURS = 7 * 24;
const THREAD_VISIBILITY = 'inherit_parent_with_exceptions';
// Slack emoji name to Unicode mapping (common emojis)
const SLACK_EMOJI_MAP = {
    // Checkmarks and symbols
    'white_check_mark': '✅',
    'heavy_check_mark': '✔️',
    'ballot_box_with_check': '☑️',
    'check': '✔️',
    'x': '❌',
    'negative_squared_cross_mark': '❎',
    'heavy_multiplication_x': '✖️',
    // Thumbs and hands
    '+1': '👍',
    'thumbsup': '👍',
    '-1': '👎',
    'thumbsdown': '👎',
    'clap': '👏',
    'wave': '👋',
    'raised_hands': '🙌',
    'pray': '🙏',
    'point_up': '☝️',
    'point_down': '👇',
    'point_left': '👈',
    'point_right': '👉',
    'ok_hand': '👌',
    'v': '✌️',
    'muscle': '💪',
    // Faces
    'smile': '😄',
    'grinning': '😀',
    'smiley': '😃',
    'joy': '😂',
    'laughing': '😆',
    'sweat_smile': '😅',
    'rofl': '🤣',
    'slightly_smiling_face': '🙂',
    'wink': '😉',
    'blush': '😊',
    'heart_eyes': '😍',
    'kissing_heart': '😘',
    'thinking_face': '🤔',
    'thinking': '🤔',
    'neutral_face': '😐',
    'expressionless': '😑',
    'unamused': '😒',
    'rolling_eyes': '🙄',
    'grimacing': '😬',
    'relieved': '😌',
    'pensive': '😔',
    'sleepy': '😪',
    'sleeping': '😴',
    'drooling_face': '🤤',
    'disappointed': '😞',
    'worried': '😟',
    'confused': '😕',
    'upside_down_face': '🙃',
    'money_mouth_face': '🤑',
    'astonished': '😲',
    'flushed': '😳',
    'scream': '😱',
    'fearful': '😨',
    'cold_sweat': '😰',
    'cry': '😢',
    'sob': '😭',
    'angry': '😠',
    'rage': '😡',
    'triumph': '😤',
    'skull': '💀',
    'poop': '💩',
    'ghost': '👻',
    'alien': '👽',
    'robot_face': '🤖',
    'see_no_evil': '🙈',
    'hear_no_evil': '🙉',
    'speak_no_evil': '🙊',
    'sunglasses': '😎',
    'nerd_face': '🤓',
    'face_with_monocle': '🧐',
    'star_struck': '🤩',
    'partying_face': '🥳',
    'smirk': '😏',
    'yum': '😋',
    'stuck_out_tongue': '😛',
    'stuck_out_tongue_winking_eye': '😜',
    'zany_face': '🤪',
    'stuck_out_tongue_closed_eyes': '😝',
    'hugging_face': '🤗',
    'shushing_face': '🤫',
    'zipper_mouth_face': '🤐',
    'raised_eyebrow': '🤨',
    'face_with_rolling_eyes': '🙄',
    'exploding_head': '🤯',
    'cowboy_hat_face': '🤠',
    'face_with_hand_over_mouth': '🤭',
    'saluting_face': '🫡',
    'melting_face': '🫠',
    'face_holding_back_tears': '🥹',
    // Hearts
    'heart': '❤️',
    'red_heart': '❤️',
    'orange_heart': '🧡',
    'yellow_heart': '💛',
    'green_heart': '💚',
    'blue_heart': '💙',
    'purple_heart': '💜',
    'black_heart': '🖤',
    'white_heart': '🤍',
    'brown_heart': '🤎',
    'broken_heart': '💔',
    'sparkling_heart': '💖',
    'heartpulse': '💗',
    'heartbeat': '💓',
    'revolving_hearts': '💞',
    'two_hearts': '💕',
    'heart_decoration': '💟',
    'heavy_heart_exclamation': '❣️',
    'fire': '🔥',
    '100': '💯',
    'star': '⭐',
    'star2': '🌟',
    'sparkles': '✨',
    'boom': '💥',
    'collision': '💥',
    'zap': '⚡',
    'sunny': '☀️',
    'rainbow': '🌈',
    // Objects and symbols
    'tada': '🎉',
    'confetti_ball': '🎊',
    'balloon': '🎈',
    'gift': '🎁',
    'trophy': '🏆',
    'medal': '🏅',
    'first_place_medal': '🥇',
    'second_place_medal': '🥈',
    'third_place_medal': '🥉',
    'crown': '👑',
    'gem': '💎',
    'moneybag': '💰',
    'dollar': '💵',
    'credit_card': '💳',
    'bell': '🔔',
    'no_bell': '🔕',
    'bulb': '💡',
    'flashlight': '🔦',
    'wrench': '🔧',
    'hammer': '🔨',
    'nut_and_bolt': '🔩',
    'gear': '⚙️',
    'lock': '🔒',
    'unlock': '🔓',
    'key': '🔑',
    'mag': '🔍',
    'mag_right': '🔎',
    'link': '🔗',
    'paperclip': '📎',
    'scissors': '✂️',
    'pencil2': '✏️',
    'memo': '📝',
    'book': '📖',
    'books': '📚',
    'newspaper': '📰',
    'clipboard': '📋',
    'calendar': '📅',
    'chart_with_upwards_trend': '📈',
    'chart_with_downwards_trend': '📉',
    'email': '📧',
    'envelope': '✉️',
    'inbox_tray': '📥',
    'outbox_tray': '📤',
    'package': '📦',
    'phone': '📞',
    'telephone_receiver': '📞',
    'computer': '💻',
    'desktop_computer': '🖥️',
    'keyboard': '⌨️',
    'printer': '🖨️',
    'camera': '📷',
    'video_camera': '📹',
    'microphone': '🎤',
    'headphones': '🎧',
    'musical_note': '🎵',
    'notes': '🎶',
    'guitar': '🎸',
    'movie_camera': '🎥',
    'clapper': '🎬',
    'tv': '📺',
    'radio': '📻',
    'stopwatch': '⏱️',
    'alarm_clock': '⏰',
    'hourglass': '⌛',
    'hourglass_flowing_sand': '⏳',
    'battery': '🔋',
    'electric_plug': '🔌',
    'rocket': '🚀',
    'airplane': '✈️',
    'car': '🚗',
    'bike': '🚲',
    'ship': '🚢',
    'anchor': '⚓',
    'warning': '⚠️',
    'construction': '🚧',
    'rotating_light': '🚨',
    'traffic_light': '🚦',
    'stop_sign': '🛑',
    // Food and drink
    'coffee': '☕',
    'tea': '🍵',
    'beer': '🍺',
    'beers': '🍻',
    'wine_glass': '🍷',
    'cocktail': '🍸',
    'pizza': '🍕',
    'hamburger': '🍔',
    'fries': '🍟',
    'hotdog': '🌭',
    'taco': '🌮',
    'burrito': '🌯',
    'popcorn': '🍿',
    'ice_cream': '🍦',
    'doughnut': '🍩',
    'cookie': '🍪',
    'cake': '🎂',
    'birthday': '🎂',
    'chocolate_bar': '🍫',
    'candy': '🍬',
    'lollipop': '🍭',
    'apple': '🍎',
    'green_apple': '🍏',
    'pear': '🍐',
    'orange': '🍊',
    'lemon': '🍋',
    'banana': '🍌',
    'watermelon': '🍉',
    'grapes': '🍇',
    'strawberry': '🍓',
    'peach': '🍑',
    'cherries': '🍒',
    'avocado': '🥑',
    'eggplant': '🍆',
    'potato': '🥔',
    'carrot': '🥕',
    'corn': '🌽',
    'hot_pepper': '🌶️',
    'broccoli': '🥦',
    'egg': '🥚',
    'bacon': '🥓',
    'croissant': '🥐',
    'bread': '🍞',
    'cheese': '🧀',
    // Animals
    'dog': '🐕',
    'dog2': '🐶',
    'cat': '🐈',
    'cat2': '🐱',
    'mouse': '🐁',
    'mouse2': '🐭',
    'hamster': '🐹',
    'rabbit': '🐰',
    'rabbit2': '🐇',
    'fox_face': '🦊',
    'bear': '🐻',
    'panda_face': '🐼',
    'koala': '🐨',
    'tiger': '🐯',
    'tiger2': '🐅',
    'lion_face': '🦁',
    'lion': '🦁',
    'cow': '🐄',
    'cow2': '🐮',
    'pig': '🐷',
    'pig2': '🐖',
    'pig_nose': '🐽',
    'monkey': '🐒',
    'monkey_face': '🐵',
    'gorilla': '🦍',
    'chicken': '🐔',
    'penguin': '🐧',
    'bird': '🐦',
    'hatched_chick': '🐥',
    'hatching_chick': '🐣',
    'baby_chick': '🐤',
    'eagle': '🦅',
    'duck': '🦆',
    'owl': '🦉',
    'bat': '🦇',
    'wolf': '🐺',
    'boar': '🐗',
    'horse': '🐴',
    'unicorn': '🦄',
    'unicorn_face': '🦄',
    'bee': '🐝',
    'honeybee': '🐝',
    'bug': '🐛',
    'butterfly': '🦋',
    'snail': '🐌',
    'beetle': '🪲',
    'ant': '🐜',
    'spider': '🕷️',
    'spider_web': '🕸️',
    'turtle': '🐢',
    'snake': '🐍',
    'lizard': '🦎',
    'scorpion': '🦂',
    'crab': '🦀',
    'lobster': '🦞',
    'shrimp': '🦐',
    'squid': '🦑',
    'octopus': '🐙',
    'tropical_fish': '🐠',
    'fish': '🐟',
    'blowfish': '🐡',
    'dolphin': '🐬',
    'shark': '🦈',
    'whale': '🐳',
    'whale2': '🐋',
    'crocodile': '🐊',
    'leopard': '🐆',
    'zebra_face': '🦓',
    'goat': '🐐',
    'ram': '🐏',
    'sheep': '🐑',
    'camel': '🐫',
    'dromedary_camel': '🐪',
    'llama': '🦙',
    'giraffe_face': '🦒',
    'elephant': '🐘',
    'rhinoceros': '🦏',
    'hippopotamus': '🦛',
    'mouse_face': '🐭',
    'rat': '🐀',
    'chipmunk': '🐿️',
    'hedgehog': '🦔',
    'feet': '🐾',
    'paw_prints': '🐾',
    'dragon': '🐉',
    'dragon_face': '🐲',
    // Nature
    'sun_with_face': '🌞',
    'full_moon_with_face': '🌝',
    'new_moon_with_face': '🌚',
    'first_quarter_moon_with_face': '🌛',
    'last_quarter_moon_with_face': '🌜',
    'crescent_moon': '🌙',
    'earth_americas': '🌎',
    'earth_africa': '🌍',
    'earth_asia': '🌏',
    'cloud': '☁️',
    'partly_sunny': '⛅',
    'thunder_cloud_and_rain': '⛈️',
    'snowflake': '❄️',
    'snowman': '⛄',
    'snowman_without_snow': '⛄',
    'umbrella': '☂️',
    'droplet': '💧',
    'ocean': '🌊',
    'rose': '🌹',
    'tulip': '🌷',
    'sunflower': '🌻',
    'hibiscus': '🌺',
    'cherry_blossom': '🌸',
    'blossom': '🌼',
    'bouquet': '💐',
    'seedling': '🌱',
    'evergreen_tree': '🌲',
    'deciduous_tree': '🌳',
    'palm_tree': '🌴',
    'cactus': '🌵',
    'herb': '🌿',
    'shamrock': '☘️',
    'four_leaf_clover': '🍀',
    'maple_leaf': '🍁',
    'fallen_leaf': '🍂',
    'leaves': '🍃',
    'mushroom': '🍄',
    // Arrows and misc
    'arrow_up': '⬆️',
    'arrow_down': '⬇️',
    'arrow_left': '⬅️',
    'arrow_right': '➡️',
    'arrow_upper_left': '↖️',
    'arrow_upper_right': '↗️',
    'arrow_lower_left': '↙️',
    'arrow_lower_right': '↘️',
    'left_right_arrow': '↔️',
    'arrow_up_down': '↕️',
    'arrows_counterclockwise': '🔄',
    'arrows_clockwise': '🔃',
    'back': '🔙',
    'end': '🔚',
    'on': '🔛',
    'soon': '🔜',
    'top': '🔝',
    'new': '🆕',
    'free': '🆓',
    'up': '🆙',
    'cool': '🆒',
    'ok': '🆗',
    'sos': '🆘',
    'no_entry': '⛔',
    'no_entry_sign': '🚫',
    'name_badge': '📛',
    'o': '⭕',
    'white_circle': '⚪',
    'black_circle': '⚫',
    'red_circle': '🔴',
    'blue_circle': '🔵',
    'large_orange_diamond': '🔶',
    'large_blue_diamond': '🔷',
    'small_orange_diamond': '🔸',
    'small_blue_diamond': '🔹',
    'small_red_triangle': '🔺',
    'small_red_triangle_down': '🔻',
    'question': '❓',
    'grey_question': '❔',
    'exclamation': '❗',
    'grey_exclamation': '❕',
    'bangbang': '‼️',
    'interrobang': '⁉️',
    'hash': '#️⃣',
    'asterisk': '*️⃣',
    'zero': '0️⃣',
    'one': '1️⃣',
    'two': '2️⃣',
    'three': '3️⃣',
    'four': '4️⃣',
    'five': '5️⃣',
    'six': '6️⃣',
    'seven': '7️⃣',
    'eight': '8️⃣',
    'nine': '9️⃣',
    'keycap_ten': '🔟',
    'a': '🅰️',
    'b': '🅱️',
    'ab': '🆎',
    'cl': '🆑',
    'o2': '🅾️',
    'information_source': 'ℹ️',
    'id': '🆔',
    'm': 'Ⓜ️',
    'ng': '🆖',
    'parking': '🅿️',
    'vs': '🆚',
    'accept': '🉑',
    'ideograph_advantage': '🉐',
    'congratulations': '㊗️',
    'secret': '㊙️',
    'u6e80': '🈵',
    'u7a7a': '🈳',
    'copyright': '©️',
    'registered': '®️',
    'tm': '™️',
    // People activities
    'eyes': '👀',
    'eye': '👁️',
    'ear': '👂',
    'nose': '👃',
    'lips': '👄',
    'tongue': '👅',
    'brain': '🧠',
    'anatomical_heart': '🫀',
    'lungs': '🫁',
    'bone': '🦴',
    'tooth': '🦷',
    'man': '👨',
    'woman': '👩',
    'boy': '👦',
    'girl': '👧',
    'baby': '👶',
    'older_man': '👴',
    'older_woman': '👵',
    'person_with_blond_hair': '👱',
    'man_with_gua_pi_mao': '👲',
    'person_with_headscarf': '🧕',
    'man_in_tuxedo': '🤵',
    'bride_with_veil': '👰',
    'pregnant_woman': '🤰',
    'angel': '👼',
    'santa': '🎅',
    'mrs_claus': '🤶',
    'superhero': '🦸',
    'supervillain': '🦹',
    'mage': '🧙',
    'fairy': '🧚',
    'vampire': '🧛',
    'merperson': '🧜',
    'elf': '🧝',
    'genie': '🧞',
    'zombie': '🧟',
    'person_frowning': '🙍',
    'person_with_pouting_face': '🙎',
    'no_good': '🙅',
    'ok_woman': '🙆',
    'information_desk_person': '💁',
    'raising_hand': '🙋',
    'bow': '🙇',
    'person_facepalming': '🤦',
    'shrug': '🤷',
    'cop': '👮',
    'guardsman': '💂',
    'construction_worker': '👷',
    'prince': '🤴',
    'princess': '👸',
    'man_with_turban': '👳',
    'detective': '🕵️',
    'dancer': '💃',
    'man_dancing': '🕺',
    'dancers': '👯',
    'person_running': '🏃',
    'runner': '🏃',
    'walking': '🚶',
    'person_standing': '🧍',
    'person_kneeling': '🧎',
    'couple': '👫',
    'two_men_holding_hands': '👬',
    'two_women_holding_hands': '👭',
    'couplekiss': '💏',
    'couple_with_heart': '💑',
    'family': '👪',
};
/**
 * Convert Slack emoji name to Unicode emoji
 */
function slackEmojiToUnicode(slackName) {
    // Remove colons if present (e.g., ":white_check_mark:" -> "white_check_mark")
    const cleanName = slackName.replace(/^:|:$/g, '').toLowerCase();
    // Check our mapping
    if (SLACK_EMOJI_MAP[cleanName]) {
        return SLACK_EMOJI_MAP[cleanName];
    }
    // Handle skin tone variants (e.g., "thumbsup::skin-tone-2")
    const baseName = cleanName.split('::')[0];
    if (SLACK_EMOJI_MAP[baseName]) {
        return SLACK_EMOJI_MAP[baseName];
    }
    // If not found, return the original name wrapped in colons for display
    // This allows the frontend to show ":unknown_emoji:" as fallback
    return `:${cleanName}:`;
}
const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));
const nextAutoArchiveAt = (ttlHours) => {
    const ttl = clampNumber(ttlHours, 1, THREAD_ARCHIVE_MAX_HOURS);
    return Date.now() + ttl * 60 * 60 * 1000;
};
const normalizeText = (value) => typeof value === 'string' ? value.trim() : '';
const compactWhitespace = (value) => value.replace(/\s+/g, ' ').trim();
const previewFromText = (value, max = 120) => {
    const cleaned = compactWhitespace(normalizeText(value));
    if (!cleaned)
        return '';
    return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
};
const threadNameFromText = (value) => {
    const cleaned = previewFromText(value, 48);
    return cleaned || 'Thread';
};
const isSlackUid = (value) => typeof value === 'string' && value.startsWith('slack:');
const pickMessageText = (data) => {
    if (!data)
        return '';
    return normalizeText(data.plainTextContent ?? data.text ?? data.content ?? data.preview ?? '');
};
const pickMessageAuthorId = (data) => {
    if (!data)
        return null;
    const uid = typeof data.uid === 'string' ? data.uid : null;
    const authorId = typeof data.authorId === 'string' ? data.authorId : null;
    const picked = normalizeText(uid ?? authorId ?? '');
    return picked || null;
};
// ============ Credentials Helpers ============
/**
 * Get server config with credentials for a server
 */
async function getServerSlackConfig(serverId) {
    const configDoc = await firebase_1.db.doc(`servers/${serverId}/integrations/slack`).get();
    if (!configDoc.exists) {
        return null;
    }
    return configDoc.data();
}
/**
 * Find server ID by Slack team ID (look through all workspaces)
 */
async function findServerByTeamId(teamId) {
    // Search across all servers for a workspace with this team ID
    const serversSnapshot = await firebase_1.db.collection('servers').get();
    for (const serverDoc of serversSnapshot.docs) {
        const workspacesSnapshot = await firebase_1.db
            .collection(`servers/${serverDoc.id}/integrations/slack/workspaces`)
            .where('teamId', '==', teamId)
            .limit(1)
            .get();
        if (!workspacesSnapshot.empty) {
            return serverDoc.id;
        }
    }
    return null;
}
// ============ Verification ============
/**
 * Verify Slack request signature
 */
function verifySlackSignature(signingSecret, signature, timestamp, body) {
    if (!signature || !timestamp) {
        firebase_functions_1.logger.warn('[slack] Missing signature or timestamp');
        return false;
    }
    // Check timestamp is within 5 minutes
    const time = Math.floor(Date.now() / 1000);
    if (Math.abs(time - parseInt(timestamp)) > 300) {
        firebase_functions_1.logger.warn('[slack] Request timestamp too old');
        return false;
    }
    // Compute expected signature
    const sigBaseString = `v0:${timestamp}:${body}`;
    const mySignature = 'v0=' + crypto
        .createHmac('sha256', signingSecret)
        .update(sigBaseString, 'utf8')
        .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(mySignature, 'utf8'), Buffer.from(signature, 'utf8'));
}
// ============ Slack API Helpers ============
/**
 * Fetch Slack user info and cache it
 */
async function getSlackUser(userId, botToken) {
    // Check cache first
    const cached = slackUserCache[userId];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return cached;
    }
    try {
        const response = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
            headers: {
                'Authorization': `Bearer ${botToken}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        if (data.ok && data.user) {
            const userInfo = {
                name: data.user.profile?.display_name || data.user.name,
                realName: data.user.real_name,
                avatar: data.user.profile?.image_48,
                fetchedAt: Date.now()
            };
            slackUserCache[userId] = userInfo;
            return userInfo;
        }
        return null;
    }
    catch (err) {
        firebase_functions_1.logger.error('[slack] Failed to fetch user info', { userId, error: err });
        return null;
    }
}
/**
 * Convert Slack markdown to hConnect format
 */
function convertSlackToHConnect(text) {
    if (!text)
        return '';
    let converted = text;
    // Convert Slack user mentions <@U123ABC> to placeholder
    converted = converted.replace(/<@([A-Z0-9]+)>/g, '@slack-user');
    // Convert Slack channel mentions <#C123ABC|channel-name>
    converted = converted.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1');
    // Convert Slack links <http://example.com|text> or <http://example.com>
    converted = converted.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '[$2]($1)');
    converted = converted.replace(/<(https?:\/\/[^>]+)>/g, '$1');
    // Convert Slack bold *text* (but not already converted markdown)
    // Slack uses single * for bold, hConnect/markdown uses **
    // Be careful not to double-convert
    converted = converted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '**$1**');
    // Slack _italic_ to *italic*
    converted = converted.replace(/(?<!_)_([^_]+)_(?!_)/g, '*$1*');
    // Slack ~strikethrough~ to ~~strikethrough~~
    converted = converted.replace(/~([^~]+)~/g, '~~$1~~');
    // Convert Slack code blocks ```code``` (already compatible)
    // Convert inline code `code` (already compatible)
    return converted;
}
// ============ Bridge Lookup ============
/**
 * Find bridge for a Slack channel (searches across all servers)
 * Returns the bridge and its server ID
 */
async function findBridgeForSlackChannel(teamId, channelId) {
    // Search across all servers
    const serversSnapshot = await firebase_1.db.collection('servers').get();
    for (const serverDoc of serversSnapshot.docs) {
        const bridgesSnapshot = await firebase_1.db
            .collection(`servers/${serverDoc.id}/integrations/slack/bridges`)
            .where('slackTeamId', '==', teamId)
            .where('slackChannelId', '==', channelId)
            .where('status', '==', 'active')
            .limit(1)
            .get();
        if (!bridgesSnapshot.empty) {
            const doc = bridgesSnapshot.docs[0];
            return {
                bridge: { id: doc.id, ...doc.data() },
                serverId: serverDoc.id
            };
        }
    }
    return null;
}
/**
 * Get workspace by team ID for a specific server
 */
async function getWorkspaceByTeamId(serverId, teamId) {
    const workspacesSnapshot = await firebase_1.db
        .collection(`servers/${serverId}/integrations/slack/workspaces`)
        .where('teamId', '==', teamId)
        .limit(1)
        .get();
    if (workspacesSnapshot.empty) {
        return null;
    }
    const doc = workspacesSnapshot.docs[0];
    return { id: doc.id, serverId, ...doc.data() };
}
// ============ Message Sync ============
/**
 * Create an hConnect message from a Slack message
 */
async function syncSlackMessageToHConnect(event, bridge, workspace, serverId) {
    // Skip bot messages to avoid loops
    if (event.bot_id || event.subtype === 'bot_message') {
        firebase_functions_1.logger.info('[slack] Skipping bot message');
        return;
    }
    // Skip message subtypes we don't handle
    const skipSubtypes = ['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose'];
    if (event.subtype && skipSubtypes.includes(event.subtype)) {
        firebase_functions_1.logger.info('[slack] Skipping system message', { subtype: event.subtype });
        return;
    }
    // Get Slack user info
    let authorName = 'Slack User';
    let authorAvatar;
    if (bridge.showSlackUsernames && event.user) {
        const userInfo = await getSlackUser(event.user, workspace.botAccessToken);
        if (userInfo) {
            authorName = userInfo.realName || userInfo.name;
            authorAvatar = userInfo.avatar;
        }
    }
    // Convert message content
    const content = convertSlackToHConnect(event.text);
    const hconnectServerId = bridge.hconnectServerId || serverId;
    const hconnectChannelId = bridge.hconnectChannelId;
    const slackUid = `slack:${event.user}`;
    // Create the message document
    let messageRef = firebase_1.db
        .collection(`servers/${hconnectServerId}/channels/${hconnectChannelId}/messages`)
        .doc();
    // Check if this is a thread reply and find the parent message
    let replyToId = null;
    let isThreadReply = false;
    let threadTarget = null;
    if (event.thread_ts && event.thread_ts !== event.ts) {
        isThreadReply = true;
        // Find the parent message in hConnect
        const parentMessage = await findHConnectMessageBySlackTs(hconnectServerId, hconnectChannelId, event.thread_ts);
        if (parentMessage) {
            replyToId = parentMessage.id;
            if (bridge.syncThreads !== false) {
                try {
                    threadTarget = await ensureThreadForParentMessage({
                        serverId: hconnectServerId,
                        channelId: hconnectChannelId,
                        parentMessageId: parentMessage.id,
                        parentMessageData: parentMessage.data,
                        fallbackCreatorId: slackUid
                    });
                }
                catch (err) {
                    firebase_functions_1.logger.warn('[slack] Failed to ensure thread for Slack reply', {
                        serverId: hconnectServerId,
                        channelId: hconnectChannelId,
                        parentMessageId: parentMessage.id,
                        error: err
                    });
                }
            }
            else {
                firebase_functions_1.logger.info('[slack] Thread sync disabled for bridge, storing reply as channel message', {
                    bridgeId: bridge.id,
                    parentMessageId: parentMessage.id
                });
            }
        }
        else {
            firebase_functions_1.logger.warn('[slack] Thread reply missing parent message, storing as channel message', {
                bridgeId: bridge.id,
                threadTs: event.thread_ts
            });
        }
    }
    if (threadTarget) {
        messageRef = firebase_1.db
            .collection(`servers/${hconnectServerId}/channels/${hconnectChannelId}/threads/${threadTarget.id}/messages`)
            .doc();
    }
    const baseMessageData = {
        // Core fields
        uid: slackUid, // Special UID format for Slack users
        authorId: slackUid,
        text: content,
        content: content,
        plainTextContent: event.text,
        // Author info (for display)
        author: {
            displayName: authorName,
            photoURL: authorAvatar || null,
            isSlackUser: true
        },
        displayName: authorName,
        // Slack metadata
        slackMeta: {
            teamId: event.team || bridge.slackTeamId,
            channelId: event.channel,
            userId: event.user,
            messageTs: event.ts,
            threadTs: event.thread_ts || null,
            bridgeId: bridge.id,
            isThreadReply
        },
        // Timestamps
        createdAt: firestore_1.Timestamp.now(),
        updatedAt: firestore_1.Timestamp.now(),
        // Flags
        isSlackMessage: true,
        type: 'text'
    };
    const messageData = threadTarget
        ? {
            ...baseMessageData,
            serverId: hconnectServerId,
            channelId: hconnectChannelId,
            threadId: threadTarget.id,
            ...(isThreadReply && { isThreadReply: true })
        }
        : {
            ...baseMessageData,
            ...(replyToId && { replyTo: replyToId }),
            ...(isThreadReply && { isThreadReply: true })
        };
    await messageRef.set(messageData);
    if (threadTarget) {
        const preview = previewFromText(content, 120) || 'New message';
        const ttlHours = typeof threadTarget.data?.ttlHours === 'number'
            ? threadTarget.data.ttlHours
            : THREAD_DEFAULT_TTL_HOURS;
        await firebase_1.db
            .doc(`servers/${hconnectServerId}/channels/${hconnectChannelId}/threads/${threadTarget.id}`)
            .update({
            lastMessageAt: firestore_1.Timestamp.now(),
            lastMessagePreview: preview,
            autoArchiveAt: nextAutoArchiveAt(ttlHours),
            status: 'active',
            archivedAt: null,
            messageCount: firestore_1.FieldValue.increment(1)
        });
    }
    // Update bridge stats (using per-server path)
    await firebase_1.db.doc(`servers/${hconnectServerId}/integrations/slack/bridges/${bridge.id}`).update({
        lastSyncAt: firestore_1.Timestamp.now(),
        messageCount: firestore_1.FieldValue.increment(1)
    });
    firebase_functions_1.logger.info('[slack] Message synced to hConnect', {
        bridgeId: bridge.id,
        messageId: messageRef.id,
        slackTs: event.ts
    });
}
/**
 * Find hConnect message by Slack timestamp
 * Searches both channel messages and thread messages
 */
async function findHConnectMessageBySlackTs(serverId, channelId, slackTs) {
    // First, search in channel messages
    const messagesSnapshot = await firebase_1.db
        .collection(`servers/${serverId}/channels/${channelId}/messages`)
        .where('slackMeta.messageTs', '==', slackTs)
        .limit(1)
        .get();
    if (!messagesSnapshot.empty) {
        const doc = messagesSnapshot.docs[0];
        const data = doc.data();
        return {
            id: doc.id,
            data,
            reactions: data.reactions || {}
        };
    }
    // If not found, search in thread messages (collection group query)
    // First get all threads for this channel
    const threadsSnapshot = await firebase_1.db
        .collection(`servers/${serverId}/channels/${channelId}/threads`)
        .get();
    for (const threadDoc of threadsSnapshot.docs) {
        const threadMessagesSnapshot = await firebase_1.db
            .collection(`servers/${serverId}/channels/${channelId}/threads/${threadDoc.id}/messages`)
            .where('slackMeta.messageTs', '==', slackTs)
            .limit(1)
            .get();
        if (!threadMessagesSnapshot.empty) {
            const doc = threadMessagesSnapshot.docs[0];
            const data = doc.data();
            return {
                id: doc.id,
                data,
                reactions: data.reactions || {},
                threadId: threadDoc.id
            };
        }
    }
    return null;
}
async function findThreadByParentMessageId(serverId, channelId, parentMessageId) {
    const threadsSnapshot = await firebase_1.db
        .collection(`servers/${serverId}/channels/${channelId}/threads`)
        .where('createdFromMessageId', '==', parentMessageId)
        .limit(1)
        .get();
    if (threadsSnapshot.empty) {
        return null;
    }
    const doc = threadsSnapshot.docs[0];
    return { id: doc.id, data: doc.data() };
}
async function createThreadForParentMessage(options) {
    const { serverId, channelId, parentMessageId, parentMessageData, fallbackCreatorId } = options;
    const threadRef = firebase_1.db.collection(`servers/${serverId}/channels/${channelId}/threads`).doc();
    const now = firestore_1.Timestamp.now();
    const parentText = pickMessageText(parentMessageData);
    const preview = previewFromText(parentText, 120) || 'Thread';
    const name = threadNameFromText(parentText);
    const creatorId = pickMessageAuthorId(parentMessageData) || fallbackCreatorId;
    const memberUids = creatorId && !isSlackUid(creatorId) ? [creatorId] : [];
    const payload = {
        id: threadRef.id,
        serverId,
        channelId,
        parentChannelId: channelId,
        createdBy: creatorId || null,
        createdFromMessageId: parentMessageId,
        createdAt: now,
        name,
        preview,
        rootPreview: preview,
        lastMessageAt: now,
        lastMessagePreview: preview,
        autoArchiveAt: nextAutoArchiveAt(THREAD_DEFAULT_TTL_HOURS),
        status: 'active',
        ttlHours: THREAD_DEFAULT_TTL_HOURS,
        maxMembers: THREAD_MAX_MEMBER_LIMIT,
        memberUids,
        memberCount: memberUids.length,
        visibility: THREAD_VISIBILITY,
        archivedAt: null,
        messageCount: 0
    };
    await threadRef.set(payload);
    return { id: threadRef.id, data: payload };
}
async function ensureThreadForParentMessage(options) {
    const existing = await findThreadByParentMessageId(options.serverId, options.channelId, options.parentMessageId);
    if (existing)
        return existing;
    return createThreadForParentMessage(options);
}
/**
 * Encode emoji to a Firestore-safe reaction key (matches frontend format)
 */
function encodeReactionKey(emoji) {
    const parts = Array.from(emoji ?? '')
        .map((char) => {
        const code = char.codePointAt(0);
        return code !== undefined ? code.toString(16) : null;
    })
        .filter((part) => Boolean(part));
    return parts.length ? 'u' + parts.join('_') : 'u';
}
/**
 * Sync a Slack reaction to hConnect
 */
async function syncSlackReactionToHConnect(event, bridge, workspace, serverId, isAdd) {
    if (!event.item || !event.reaction) {
        firebase_functions_1.logger.warn('[slack] Missing item or reaction in reaction event');
        return;
    }
    // Skip reactions from our own bot to prevent loops
    // When hConnect syncs a reaction to Slack, the bot adds it, and Slack sends a webhook back
    if (workspace.botUserId && event.user === workspace.botUserId) {
        firebase_functions_1.logger.info('[slack] Skipping reaction from our own bot to prevent loop', {
            botUserId: workspace.botUserId,
            reaction: event.reaction
        });
        return;
    }
    // Only handle reactions on messages
    if (event.item.type !== 'message') {
        firebase_functions_1.logger.info('[slack] Ignoring reaction on non-message item', { type: event.item.type });
        return;
    }
    // Use the hConnect server ID from bridge if available (same logic as message sync)
    const hconnectServerId = bridge.hconnectServerId || serverId;
    // Find the corresponding hConnect message
    const message = await findHConnectMessageBySlackTs(hconnectServerId, bridge.hconnectChannelId, event.item.ts);
    if (!message) {
        firebase_functions_1.logger.info('[slack] No matching hConnect message for reaction', {
            slackTs: event.item.ts,
            serverId: hconnectServerId,
            channelId: bridge.hconnectChannelId
        });
        return;
    }
    // Convert Slack emoji name to Unicode emoji
    const unicodeEmoji = slackEmojiToUnicode(event.reaction);
    // Create a Firestore-safe key from the emoji (matches hConnect's format)
    const reactionKey = encodeReactionKey(unicodeEmoji);
    const slackUserId = `slack:${event.user}`;
    // Build the correct message path (could be in channel or in a thread)
    const messagePath = message.threadId
        ? `servers/${hconnectServerId}/channels/${bridge.hconnectChannelId}/threads/${message.threadId}/messages/${message.id}`
        : `servers/${hconnectServerId}/channels/${bridge.hconnectChannelId}/messages/${message.id}`;
    const messageRef = firebase_1.db.doc(messagePath);
    firebase_functions_1.logger.info('[slack] Processing reaction', {
        slackEmoji: event.reaction,
        unicodeEmoji,
        reactionKey,
        isAdd,
        messageId: message.id
    });
    if (isAdd) {
        // Add reaction using hConnect's format: reactions.{key}.emoji and reactions.{key}.users
        await messageRef.update({
            [`reactions.${reactionKey}.emoji`]: unicodeEmoji,
            [`reactions.${reactionKey}.users.${slackUserId}`]: true,
            updatedAt: firestore_1.Timestamp.now()
        });
        firebase_functions_1.logger.info('[slack] Reaction added to hConnect message', {
            messageId: message.id,
            threadId: message.threadId || null,
            slackEmoji: event.reaction,
            unicodeEmoji,
            reactionKey,
            user: slackUserId
        });
    }
    else {
        // Remove reaction - need to use a transaction to check if we should delete the whole reaction
        const snap = await messageRef.get();
        const data = snap.data() ?? {};
        const reactions = data.reactions ?? {};
        const entry = reactions[reactionKey];
        if (entry?.users) {
            const users = { ...entry.users };
            delete users[slackUserId];
            if (Object.keys(users).length === 0) {
                // No users left, delete the entire reaction
                await messageRef.update({
                    [`reactions.${reactionKey}`]: firestore_1.FieldValue.delete(),
                    updatedAt: firestore_1.Timestamp.now()
                });
            }
            else {
                // Still has users, just remove this user
                await messageRef.update({
                    [`reactions.${reactionKey}.users.${slackUserId}`]: firestore_1.FieldValue.delete(),
                    updatedAt: firestore_1.Timestamp.now()
                });
            }
        }
        firebase_functions_1.logger.info('[slack] Reaction removed from hConnect message', {
            messageId: message.id,
            threadId: message.threadId || null,
            slackEmoji: event.reaction,
            unicodeEmoji,
            reactionKey,
            user: slackUserId
        });
    }
}
// ============ Main Webhook Handler ============
/**
 * Main Slack Events API webhook handler
 * Receives events from Slack and syncs to hConnect
 * Credentials are loaded from per-server Firestore config
 */
exports.slackWebhook = (0, https_1.onRequest)({
    region: 'us-central1',
    cors: false
}, async (req, res) => {
    // Log all incoming requests for debugging
    firebase_functions_1.logger.info('[slack] Webhook received', {
        method: req.method,
        payloadType: req.body?.type,
        hasSignature: !!req.headers['x-slack-signature'],
        hasTimestamp: !!req.headers['x-slack-request-timestamp']
    });
    // Only accept POST requests
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const rawBody = JSON.stringify(req.body);
    const timestamp = req.headers['x-slack-request-timestamp'];
    const signature = req.headers['x-slack-signature'];
    const payload = req.body;
    firebase_functions_1.logger.info('[slack] Processing payload', {
        type: payload.type,
        teamId: payload.team_id,
        eventType: payload.event?.type,
        eventChannel: payload.event?.channel,
        eventUser: payload.event?.user
    });
    // Handle URL verification challenge (no signature verification needed for this)
    // Slack sends this when you first configure the Events URL
    if (payload.type === 'url_verification') {
        firebase_functions_1.logger.info('[slack] URL verification challenge received', { challenge: payload.challenge });
        // Respond with just the challenge value as plain text
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(payload.challenge);
        return;
    }
    // For events, we need to find the server to get signing secret
    const teamId = payload.team_id;
    if (!teamId) {
        firebase_functions_1.logger.warn('[slack] No team_id in payload');
        res.status(400).send('Missing team_id');
        return;
    }
    // Find which server this team belongs to
    const serverId = await findServerByTeamId(teamId);
    if (!serverId) {
        firebase_functions_1.logger.warn('[slack] No server found for team', { teamId });
        res.status(404).send('No server configured for this Slack team');
        return;
    }
    // Get server's Slack config with signing secret
    const config = await getServerSlackConfig(serverId);
    if (!config?.credentials?.signingSecret) {
        firebase_functions_1.logger.warn('[slack] No signing secret configured for server', { serverId });
        res.status(500).send('Server not properly configured');
        return;
    }
    // Verify signature using server's signing secret
    if (!verifySlackSignature(config.credentials.signingSecret, signature, timestamp, rawBody)) {
        firebase_functions_1.logger.warn('[slack] Invalid signature', {
            signingSecretPrefix: config.credentials.signingSecret?.substring(0, 8),
            signaturePrefix: signature?.substring(0, 20),
            bodyLength: rawBody?.length
        });
        res.status(401).send('Invalid signature');
        return;
    }
    // Handle event callback
    if (payload.type === 'event_callback') {
        const event = payload.event;
        // Handle different event types
        const eventType = event.type;
        firebase_functions_1.logger.info('[slack] Processing event', { type: eventType, subtype: event.subtype });
        try {
            // Handle reaction events
            if (eventType === 'reaction_added' || eventType === 'reaction_removed') {
                const channelId = event.item?.channel || event.channel;
                // Find bridge for this channel
                const bridgeResult = await findBridgeForSlackChannel(payload.team_id, channelId);
                if (!bridgeResult) {
                    firebase_functions_1.logger.info('[slack] No active bridge for reaction channel', { channelId });
                    res.status(200).send('OK');
                    return;
                }
                const { bridge } = bridgeResult;
                // Check if reactions sync is enabled (via bridge settings)
                // For now, always sync if bridge exists and is bidirectional or slack-to-hconnect
                if (bridge.syncDirection === 'hconnect-to-slack') {
                    firebase_functions_1.logger.info('[slack] Bridge is outbound only, skipping reaction');
                    res.status(200).send('OK');
                    return;
                }
                const workspace = await getWorkspaceByTeamId(serverId, payload.team_id);
                if (!workspace) {
                    firebase_functions_1.logger.error('[slack] Workspace not found for reaction', { teamId: payload.team_id });
                    res.status(200).send('OK');
                    return;
                }
                await syncSlackReactionToHConnect(event, bridge, workspace, serverId, eventType === 'reaction_added');
                res.status(200).send('OK');
                return;
            }
            // Handle message events
            if (eventType !== 'message') {
                res.status(200).send('OK');
                return;
            }
            // Find bridge for this channel
            const bridgeResult = await findBridgeForSlackChannel(payload.team_id, event.channel);
            if (!bridgeResult) {
                firebase_functions_1.logger.info('[slack] No active bridge for channel', {
                    teamId: payload.team_id,
                    channelId: event.channel
                });
                res.status(200).send('OK');
                return;
            }
            const { bridge } = bridgeResult;
            // Check sync direction
            if (bridge.syncDirection === 'hconnect-to-slack') {
                firebase_functions_1.logger.info('[slack] Bridge is outbound only, skipping inbound message');
                res.status(200).send('OK');
                return;
            }
            // Get workspace for API calls
            const workspace = await getWorkspaceByTeamId(serverId, payload.team_id);
            if (!workspace) {
                firebase_functions_1.logger.error('[slack] Workspace not found', { teamId: payload.team_id, serverId });
                res.status(200).send('OK');
                return;
            }
            // Sync the message
            await syncSlackMessageToHConnect(event, bridge, workspace, serverId);
            res.status(200).send('OK');
        }
        catch (err) {
            firebase_functions_1.logger.error('[slack] Error processing event', { error: err, event });
            // Return 200 anyway to prevent Slack from retrying
            res.status(200).send('OK');
        }
        return;
    }
    res.status(200).send('OK');
});
/**
 * OAuth callback handler for Slack app installation
 * State parameter format: JSON with { returnUrl, serverId }
 */
exports.slackOAuth = (0, https_1.onRequest)({
    region: 'us-central1',
    cors: true
}, async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    // Parse state to get serverId and returnUrl
    let stateData = {};
    let returnUrl = 'https://hconnect-6212b.web.app';
    let serverId;
    if (state) {
        try {
            stateData = JSON.parse(decodeURIComponent(String(state)));
            returnUrl = stateData.returnUrl || returnUrl;
            serverId = stateData.serverId;
        }
        catch {
            // State might be just a URL for backward compatibility
            returnUrl = String(state);
        }
    }
    // Handle OAuth errors
    if (oauthError) {
        firebase_functions_1.logger.error('[slack] OAuth error from Slack', { error: oauthError });
        res.redirect(302, `${returnUrl}?slack_error=${encodeURIComponent(String(oauthError))}`);
        return;
    }
    if (!code) {
        res.status(400).send('Missing authorization code');
        return;
    }
    if (!serverId) {
        firebase_functions_1.logger.error('[slack] No serverId in OAuth state');
        res.redirect(302, `${returnUrl}?slack_error=missing_server_id`);
        return;
    }
    firebase_functions_1.logger.info('[slack] OAuth callback received', { serverId, returnUrl });
    // Get server's Slack credentials
    const config = await getServerSlackConfig(serverId);
    if (!config?.credentials?.clientId || !config?.credentials?.clientSecret) {
        firebase_functions_1.logger.error('[slack] Server missing Slack credentials', { serverId });
        res.redirect(302, `${returnUrl}?slack_error=missing_credentials`);
        return;
    }
    try {
        // Exchange code for access token
        const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: config.credentials.clientId,
                client_secret: config.credentials.clientSecret,
                code: String(code),
                redirect_uri: 'https://slackoauth-xpac7ukbha-uc.a.run.app'
            })
        });
        const tokenData = await tokenResponse.json();
        if (!tokenData.ok || !tokenData.access_token) {
            firebase_functions_1.logger.error('[slack] Token exchange failed', { error: tokenData.error });
            res.redirect(302, `${returnUrl}?slack_error=${encodeURIComponent(tokenData.error || 'token_exchange_failed')}`);
            return;
        }
        // Fetch team info for more details
        const teamInfoResponse = await fetch('https://slack.com/api/team.info', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json'
            }
        });
        const teamInfo = await teamInfoResponse.json();
        // Store the workspace in Firestore under the server's path
        const workspaceRef = firebase_1.db.collection(`servers/${serverId}/integrations/slack/workspaces`).doc();
        await workspaceRef.set({
            serverId,
            teamId: tokenData.team?.id || '',
            teamName: tokenData.team?.name || teamInfo.team?.name || 'Unknown Workspace',
            teamDomain: teamInfo.team?.domain || '',
            teamIcon: teamInfo.team?.icon?.image_68 || teamInfo.team?.icon?.image_44 || null,
            accessToken: tokenData.access_token, // TODO: Encrypt this in production
            botAccessToken: tokenData.access_token,
            botUserId: tokenData.bot_user_id || '',
            installedBy: tokenData.authed_user?.id || '',
            installedAt: firestore_1.Timestamp.now(),
            scopes: (tokenData.scope || '').split(',')
        });
        firebase_functions_1.logger.info('[slack] Workspace connected successfully', {
            serverId,
            teamId: tokenData.team?.id,
            teamName: tokenData.team?.name,
            workspaceId: workspaceRef.id
        });
        // Redirect back to hConnect with success
        res.redirect(302, `${returnUrl}?slack_connected=true&workspace=${encodeURIComponent(tokenData.team?.name || '')}`);
    }
    catch (err) {
        firebase_functions_1.logger.error('[slack] OAuth error', { error: err });
        res.redirect(302, `${returnUrl}?slack_error=server_error`);
    }
});
// ============ Outbound Sync (hConnect → Slack) ============
/**
 * Convert hConnect markdown to Slack mrkdwn format
 */
function convertHConnectToSlack(text) {
    if (!text)
        return '';
    let converted = text;
    // Convert markdown bold **text** to Slack *text*
    converted = converted.replace(/\*\*([^*]+)\*\*/g, '*$1*');
    // Convert markdown italic *text* to Slack _text_
    // Be careful not to convert already-converted bold
    converted = converted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '_$1_');
    // Convert markdown strikethrough ~~text~~ to Slack ~text~
    converted = converted.replace(/~~([^~]+)~~/g, '~$1~');
    // Convert markdown links [text](url) to Slack <url|text>
    converted = converted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
    // Keep code blocks and inline code as-is (compatible)
    return converted;
}
/**
 * Post a message to Slack channel
 */
async function postToSlack(botToken, channelId, text, username, iconUrl, threadTs) {
    const payload = {
        channel: channelId,
        text: text,
        unfurl_links: false,
        unfurl_media: true
    };
    // Add username display if provided
    if (username) {
        payload.username = username;
    }
    if (iconUrl) {
        payload.icon_url = iconUrl;
    }
    // Add thread_ts for thread replies
    if (threadTs) {
        payload.thread_ts = threadTs;
    }
    const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${botToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    return response.json();
}
/**
 * Find bridges for an hConnect channel that sync outbound
 */
async function findBridgesForHConnectChannel(serverId, channelId) {
    const bridgesSnapshot = await firebase_1.db
        .collection(`servers/${serverId}/integrations/slack/bridges`)
        .where('hconnectServerId', '==', serverId)
        .where('hconnectChannelId', '==', channelId)
        .where('status', '==', 'active')
        .get();
    if (bridgesSnapshot.empty) {
        return [];
    }
    return bridgesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
}
/**
 * Sync an hConnect message to Slack
 * Called from Firestore trigger in index.ts
 */
async function syncHConnectMessageToSlack(serverId, channelId, messageId, messageData) {
    firebase_functions_1.logger.info('[slack-outbound] syncHConnectMessageToSlack called', {
        serverId,
        channelId,
        messageId,
        isSlackMessage: !!messageData.isSlackMessage,
        hasSlackMeta: !!messageData.slackMeta?.messageTs
    });
    // Skip if this message came from Slack (prevent loops)
    if (messageData.isSlackMessage || messageData.slackMeta?.messageTs) {
        firebase_functions_1.logger.info('[slack-outbound] Skipping message from Slack', { messageId });
        return;
    }
    // Find active bridges for this channel that sync outbound
    const bridges = await findBridgesForHConnectChannel(serverId, channelId);
    firebase_functions_1.logger.info('[slack-outbound] Found bridges', {
        channelId,
        bridgeCount: bridges.length,
        bridges: bridges.map(b => ({ id: b.id, direction: b.syncDirection, status: b.status }))
    });
    const outboundBridges = bridges.filter(b => b.syncDirection === 'hconnect-to-slack' || b.syncDirection === 'bidirectional');
    if (outboundBridges.length === 0) {
        firebase_functions_1.logger.info('[slack-outbound] No outbound bridges configured', { channelId });
        return; // No outbound bridges configured
    }
    const text = messageData.text || messageData.content || '';
    if (!text.trim()) {
        return; // Skip empty messages
    }
    const slackText = convertHConnectToSlack(text);
    // Get server-level Slack config for avatar override
    let avatarUrl = messageData.photoURL;
    try {
        const configDoc = await firebase_1.db.doc(`servers/${serverId}/integrations/slack`).get();
        if (configDoc.exists) {
            const config = configDoc.data();
            // Use server-level avatar override if set
            if (config?.hconnectAvatarUrl) {
                avatarUrl = config.hconnectAvatarUrl;
            }
        }
    }
    catch (err) {
        firebase_functions_1.logger.warn('[slack-outbound] Could not read server Slack config for avatar', { serverId });
    }
    // Check if this is a thread reply and find parent's Slack timestamp
    // replyTo can be an object { messageId: string, ... } or just a string
    let parentSlackTs;
    const replyToId = typeof messageData.replyTo === 'object'
        ? messageData.replyTo?.messageId
        : messageData.replyTo;
    if (replyToId) {
        try {
            const parentDoc = await firebase_1.db
                .doc(`servers/${serverId}/channels/${channelId}/messages/${replyToId}`)
                .get();
            if (parentDoc.exists) {
                const parentData = parentDoc.data();
                // Check if parent has a Slack timestamp (either from original sync or from slackMeta)
                if (parentData?.slackMeta?.messageTs) {
                    parentSlackTs = parentData.slackMeta.messageTs;
                }
                else if (parentData?.slackTs) {
                    parentSlackTs = parentData.slackTs;
                }
                firebase_functions_1.logger.info('[slack-outbound] Found parent message for thread', {
                    messageId,
                    replyToId,
                    parentSlackTs: parentSlackTs || 'not found'
                });
            }
        }
        catch (err) {
            firebase_functions_1.logger.warn('[slack-outbound] Could not find parent message for thread', {
                messageId,
                replyToId
            });
        }
    }
    for (const bridge of outboundBridges) {
        try {
            // Skip thread sync if bridge explicitly has it disabled
            if (replyToId && bridge.syncThreads === false) {
                firebase_functions_1.logger.info('[slack-outbound] Skipping thread reply - syncThreads disabled', {
                    bridgeId: bridge.id,
                    messageId
                });
                continue;
            }
            // Get workspace for bot token (now from per-server path)
            const workspace = await getWorkspaceByTeamId(serverId, bridge.slackTeamId);
            if (!workspace) {
                firebase_functions_1.logger.warn('[slack-outbound] Workspace not found', {
                    bridgeId: bridge.id,
                    teamId: bridge.slackTeamId,
                    serverId
                });
                continue;
            }
            // Post to Slack - always show the hConnect user's display name
            // Pass parentSlackTs for thread replies
            const result = await postToSlack(workspace.botAccessToken, bridge.slackChannelId, slackText, messageData.displayName || 'hConnect User', avatarUrl, parentSlackTs);
            if (!result.ok) {
                firebase_functions_1.logger.error('[slack-outbound] Failed to post to Slack', {
                    bridgeId: bridge.id,
                    error: result.error
                });
                // Update bridge status on persistent errors (using per-server path)
                if (result.error === 'channel_not_found' || result.error === 'not_in_channel') {
                    await firebase_1.db.doc(`servers/${serverId}/integrations/slack/bridges/${bridge.id}`).update({
                        status: 'error',
                        lastError: result.error,
                        updatedAt: firestore_1.Timestamp.now()
                    });
                }
                continue;
            }
            // Store the Slack timestamp on the hConnect message for future thread replies
            if (result.ts) {
                try {
                    await firebase_1.db.doc(`servers/${serverId}/channels/${channelId}/messages/${messageId}`).update({
                        slackTs: result.ts,
                        'slackMeta.messageTs': result.ts,
                        'slackMeta.channelId': bridge.slackChannelId,
                        'slackMeta.teamId': bridge.slackTeamId
                    });
                }
                catch (err) {
                    firebase_functions_1.logger.warn('[slack-outbound] Could not store Slack timestamp on message', { messageId });
                }
            }
            // Update bridge stats (using per-server path)
            await firebase_1.db.doc(`servers/${serverId}/integrations/slack/bridges/${bridge.id}`).update({
                lastSyncAt: firestore_1.Timestamp.now(),
                messageCount: firestore_1.FieldValue.increment(1)
            });
            firebase_functions_1.logger.info('[slack-outbound] Message synced to Slack', {
                bridgeId: bridge.id,
                slackTs: result.ts,
                isThreadReply: !!parentSlackTs
            });
        }
        catch (err) {
            firebase_functions_1.logger.error('[slack-outbound] Error syncing to Slack', {
                bridgeId: bridge.id,
                error: err
            });
        }
    }
}
/**
 * Sync an hConnect thread message to Slack
 * Called from Firestore trigger for thread messages
 * Thread messages are stored at: servers/{serverId}/channels/{channelId}/threads/{threadId}/messages/{messageId}
 * The threadId is the thread document ID in hConnect
 */
async function syncHConnectThreadMessageToSlack(serverId, channelId, threadId, // This is the thread document ID in hConnect
messageId, messageData) {
    firebase_functions_1.logger.info('[slack-outbound-thread] syncHConnectThreadMessageToSlack called', {
        serverId,
        channelId,
        threadId,
        messageId,
        isSlackMessage: !!messageData.isSlackMessage,
        hasSlackMeta: !!messageData.slackMeta?.messageTs
    });
    // Skip if this message came from Slack (prevent loops)
    if (messageData.isSlackMessage || messageData.slackMeta?.messageTs) {
        firebase_functions_1.logger.info('[slack-outbound-thread] Skipping message from Slack', { messageId, threadId });
        return;
    }
    // Find active bridges for this channel that sync outbound
    const bridges = await findBridgesForHConnectChannel(serverId, channelId);
    firebase_functions_1.logger.info('[slack-outbound-thread] Found bridges', {
        channelId,
        threadId,
        bridgeCount: bridges.length,
        bridges: bridges.map(b => ({ id: b.id, direction: b.syncDirection, status: b.status, syncThreads: b.syncThreads }))
    });
    const outboundBridges = bridges.filter(b => (b.syncDirection === 'hconnect-to-slack' || b.syncDirection === 'bidirectional') &&
        b.syncThreads !== false // Default to true if not specified
    );
    if (outboundBridges.length === 0) {
        firebase_functions_1.logger.info('[slack-outbound-thread] No outbound bridges with thread sync enabled', {
            channelId,
            threadId
        });
        return;
    }
    const text = messageData.text || messageData.content || '';
    if (!text.trim()) {
        return; // Skip empty messages
    }
    const slackText = convertHConnectToSlack(text);
    // Get server-level Slack config for avatar override
    let avatarUrl = messageData.photoURL;
    try {
        const configDoc = await firebase_1.db.doc(`servers/${serverId}/integrations/slack`).get();
        if (configDoc.exists) {
            const config = configDoc.data();
            if (config?.hconnectAvatarUrl) {
                avatarUrl = config.hconnectAvatarUrl;
            }
        }
    }
    catch (err) {
        firebase_functions_1.logger.warn('[slack-outbound-thread] Could not read server Slack config for avatar', { serverId });
    }
    // Resolve the parent channel message from the thread document
    let parentSlackTs;
    let parentMessageId = null;
    let parentMessageData = null;
    try {
        const threadDoc = await firebase_1.db
            .doc(`servers/${serverId}/channels/${channelId}/threads/${threadId}`)
            .get();
        if (!threadDoc.exists) {
            firebase_functions_1.logger.warn('[slack-outbound-thread] Thread not found', { threadId });
            return;
        }
        const threadData = threadDoc.data();
        parentMessageId =
            typeof threadData?.createdFromMessageId === 'string'
                ? threadData.createdFromMessageId
                : null;
        if (!parentMessageId) {
            firebase_functions_1.logger.warn('[slack-outbound-thread] Thread missing parent message id', { threadId });
            return;
        }
        const parentDoc = await firebase_1.db
            .doc(`servers/${serverId}/channels/${channelId}/messages/${parentMessageId}`)
            .get();
        if (parentDoc.exists) {
            parentMessageData = parentDoc.data();
            if (parentMessageData?.slackMeta?.messageTs) {
                parentSlackTs = parentMessageData.slackMeta.messageTs;
            }
            else if (parentMessageData?.slackTs) {
                parentSlackTs = parentMessageData.slackTs;
            }
            firebase_functions_1.logger.info('[slack-outbound-thread] Found parent message', {
                threadId,
                parentMessageId,
                parentSlackTs: parentSlackTs || 'not found'
            });
        }
        else {
            firebase_functions_1.logger.warn('[slack-outbound-thread] Parent message not found', {
                threadId,
                parentMessageId
            });
        }
    }
    catch (err) {
        firebase_functions_1.logger.warn('[slack-outbound-thread] Could not find parent message', {
            threadId,
            error: err
        });
    }
    if (!parentSlackTs && parentMessageId && parentMessageData) {
        const hasSlackMeta = Boolean(parentMessageData?.slackMeta?.messageTs || parentMessageData?.slackTs);
        if (!hasSlackMeta && !parentMessageData.isSlackMessage) {
            firebase_functions_1.logger.info('[slack-outbound-thread] Syncing parent message to Slack for thread', {
                threadId,
                parentMessageId
            });
            try {
                await syncHConnectMessageToSlack(serverId, channelId, parentMessageId, parentMessageData);
                const refreshed = await firebase_1.db
                    .doc(`servers/${serverId}/channels/${channelId}/messages/${parentMessageId}`)
                    .get();
                if (refreshed.exists) {
                    const refreshedData = refreshed.data();
                    parentSlackTs =
                        refreshedData?.slackMeta?.messageTs ??
                            refreshedData?.slackTs ??
                            parentSlackTs;
                }
            }
            catch (err) {
                firebase_functions_1.logger.warn('[slack-outbound-thread] Failed to sync parent message', {
                    threadId,
                    parentMessageId,
                    error: err
                });
            }
        }
    }
    if (!parentSlackTs) {
        firebase_functions_1.logger.warn('[slack-outbound-thread] Cannot sync thread - parent has no Slack timestamp', {
            threadId,
            messageId
        });
        return;
    }
    for (const bridge of outboundBridges) {
        try {
            const workspace = await getWorkspaceByTeamId(serverId, bridge.slackTeamId);
            if (!workspace) {
                firebase_functions_1.logger.warn('[slack-outbound-thread] Workspace not found', {
                    bridgeId: bridge.id,
                    teamId: bridge.slackTeamId,
                    serverId
                });
                continue;
            }
            // Post to Slack as a thread reply
            const result = await postToSlack(workspace.botAccessToken, bridge.slackChannelId, slackText, messageData.displayName || 'hConnect User', avatarUrl, parentSlackTs // This makes it a thread reply
            );
            if (!result.ok) {
                firebase_functions_1.logger.error('[slack-outbound-thread] Failed to post to Slack', {
                    bridgeId: bridge.id,
                    error: result.error
                });
                continue;
            }
            // Store the Slack timestamp on the thread message
            if (result.ts) {
                try {
                    await firebase_1.db.doc(`servers/${serverId}/channels/${channelId}/threads/${threadId}/messages/${messageId}`).update({
                        slackTs: result.ts,
                        'slackMeta.messageTs': result.ts,
                        'slackMeta.channelId': bridge.slackChannelId,
                        'slackMeta.teamId': bridge.slackTeamId,
                        'slackMeta.threadTs': parentSlackTs
                    });
                }
                catch (err) {
                    firebase_functions_1.logger.warn('[slack-outbound-thread] Could not store Slack timestamp', { messageId });
                }
            }
            // Update bridge stats
            await firebase_1.db.doc(`servers/${serverId}/integrations/slack/bridges/${bridge.id}`).update({
                lastSyncAt: firestore_1.Timestamp.now(),
                messageCount: firestore_1.FieldValue.increment(1)
            });
            firebase_functions_1.logger.info('[slack-outbound-thread] Thread message synced to Slack', {
                bridgeId: bridge.id,
                slackTs: result.ts,
                parentSlackTs
            });
        }
        catch (err) {
            firebase_functions_1.logger.error('[slack-outbound-thread] Error syncing to Slack', {
                bridgeId: bridge.id,
                error: err
            });
        }
    }
}
/**
 * Fetch list of Slack channels for a workspace
 * Called from frontend to populate channel picker
 */
exports.getSlackChannels = (0, https_1.onCall)({
    region: 'us-central1'
}, async (request) => {
    // Require authentication
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in');
    }
    const { serverId, workspaceId } = request.data;
    if (!serverId || !workspaceId) {
        throw new https_1.HttpsError('invalid-argument', 'Missing serverId or workspaceId');
    }
    firebase_functions_1.logger.info('[slack] Fetching channels', { serverId, workspaceId });
    try {
        // Get workspace to get the bot token
        const workspaceDoc = await firebase_1.db
            .doc(`servers/${serverId}/integrations/slack/workspaces/${workspaceId}`)
            .get();
        if (!workspaceDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Workspace not found');
        }
        const workspace = workspaceDoc.data();
        const botToken = workspace.botAccessToken || workspace.accessToken;
        if (!botToken) {
            throw new https_1.HttpsError('failed-precondition', 'No bot token available');
        }
        // Fetch public channels
        const publicChannels = await fetchSlackChannelList(botToken, false);
        // Fetch private channels the bot is in
        const privateChannels = await fetchSlackChannelList(botToken, true);
        const allChannels = [...publicChannels, ...privateChannels];
        // Sort by name
        allChannels.sort((a, b) => a.name.localeCompare(b.name));
        firebase_functions_1.logger.info('[slack] Fetched channels', {
            count: allChannels.length,
            public: publicChannels.length,
            private: privateChannels.length
        });
        return { channels: allChannels };
    }
    catch (err) {
        firebase_functions_1.logger.error('[slack] Failed to fetch channels', { error: err });
        if (err instanceof https_1.HttpsError)
            throw err;
        throw new https_1.HttpsError('internal', 'Failed to fetch Slack channels');
    }
});
/**
 * Fetch channel list from Slack API
 */
async function fetchSlackChannelList(botToken, isPrivate) {
    const channels = [];
    let cursor;
    do {
        const params = new URLSearchParams({
            types: isPrivate ? 'private_channel' : 'public_channel',
            exclude_archived: 'true',
            limit: '200'
        });
        if (cursor)
            params.append('cursor', cursor);
        firebase_functions_1.logger.info('[slack] Calling conversations.list', { isPrivate, cursor: cursor || 'none' });
        const response = await fetch(`https://slack.com/api/conversations.list?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${botToken}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        firebase_functions_1.logger.info('[slack] conversations.list response', {
            ok: data.ok,
            error: data.error,
            channelCount: data.channels?.length || 0,
            isPrivate
        });
        if (!data.ok) {
            firebase_functions_1.logger.warn('[slack] conversations.list failed', { error: data.error, isPrivate });
            break;
        }
        if (data.channels) {
            for (const ch of data.channels) {
                channels.push({
                    id: ch.id,
                    name: ch.name,
                    is_private: ch.is_private,
                    is_member: ch.is_member,
                    num_members: ch.num_members,
                    topic: ch.topic?.value,
                    purpose: ch.purpose?.value
                });
            }
        }
        cursor = data.response_metadata?.next_cursor;
    } while (cursor);
    return channels;
}
// ============ Outbound Reaction Sync (hConnect → Slack) ============
/**
 * Unicode emoji to Slack emoji name mapping (reverse of SLACK_EMOJI_MAP)
 */
const UNICODE_TO_SLACK = {
    '✅': 'white_check_mark',
    '✔️': 'heavy_check_mark',
    '☑️': 'ballot_box_with_check',
    '❌': 'x',
    '❎': 'negative_squared_cross_mark',
    '✖️': 'heavy_multiplication_x',
    '👍': '+1',
    '👎': '-1',
    '👏': 'clap',
    '👋': 'wave',
    '🙌': 'raised_hands',
    '🙏': 'pray',
    '☝️': 'point_up',
    '👇': 'point_down',
    '👈': 'point_left',
    '👉': 'point_right',
    '👌': 'ok_hand',
    '✌️': 'v',
    '💪': 'muscle',
    '😄': 'smile',
    '😀': 'grinning',
    '😃': 'smiley',
    '😂': 'joy',
    '😆': 'laughing',
    '😅': 'sweat_smile',
    '🤣': 'rofl',
    '🙂': 'slightly_smiling_face',
    '😉': 'wink',
    '😊': 'blush',
    '😍': 'heart_eyes',
    '😘': 'kissing_heart',
    '🤔': 'thinking_face',
    '😐': 'neutral_face',
    '😑': 'expressionless',
    '😒': 'unamused',
    '🙄': 'rolling_eyes',
    '😬': 'grimacing',
    '😌': 'relieved',
    '😔': 'pensive',
    '😪': 'sleepy',
    '😴': 'sleeping',
    '🤤': 'drooling_face',
    '😞': 'disappointed',
    '😟': 'worried',
    '😕': 'confused',
    '🙃': 'upside_down_face',
    '🤑': 'money_mouth_face',
    '😲': 'astonished',
    '😳': 'flushed',
    '😱': 'scream',
    '😨': 'fearful',
    '😰': 'cold_sweat',
    '😢': 'cry',
    '😭': 'sob',
    '😠': 'angry',
    '😡': 'rage',
    '😤': 'triumph',
    '💀': 'skull',
    '💩': 'poop',
    '👻': 'ghost',
    '👽': 'alien',
    '🤖': 'robot_face',
    '🙈': 'see_no_evil',
    '🙉': 'hear_no_evil',
    '🙊': 'speak_no_evil',
    '😎': 'sunglasses',
    '🤓': 'nerd_face',
    '🧐': 'face_with_monocle',
    '🤩': 'star_struck',
    '🥳': 'partying_face',
    '😏': 'smirk',
    '😋': 'yum',
    '😛': 'stuck_out_tongue',
    '😜': 'stuck_out_tongue_winking_eye',
    '🤪': 'zany_face',
    '😝': 'stuck_out_tongue_closed_eyes',
    '🤗': 'hugging_face',
    '🤫': 'shushing_face',
    '🤐': 'zipper_mouth_face',
    '🤨': 'raised_eyebrow',
    '🤯': 'exploding_head',
    '🤠': 'cowboy_hat_face',
    '🤭': 'face_with_hand_over_mouth',
    '🫡': 'saluting_face',
    '🫠': 'melting_face',
    '🥹': 'face_holding_back_tears',
    '❤️': 'heart',
    '🧡': 'orange_heart',
    '💛': 'yellow_heart',
    '💚': 'green_heart',
    '💙': 'blue_heart',
    '💜': 'purple_heart',
    '🖤': 'black_heart',
    '🤍': 'white_heart',
    '🤎': 'brown_heart',
    '💔': 'broken_heart',
    '💖': 'sparkling_heart',
    '💗': 'heartpulse',
    '💓': 'heartbeat',
    '💞': 'revolving_hearts',
    '💕': 'two_hearts',
    '💟': 'heart_decoration',
    '❣️': 'heavy_heart_exclamation',
    '🔥': 'fire',
    '💯': '100',
    '⭐': 'star',
    '🌟': 'star2',
    '✨': 'sparkles',
    '💥': 'boom',
    '⚡': 'zap',
    '☀️': 'sunny',
    '🌈': 'rainbow',
    '🎉': 'tada',
    '🎊': 'confetti_ball',
    '🎈': 'balloon',
    '🎁': 'gift',
    '🏆': 'trophy',
    '🏅': 'medal',
    '🥇': 'first_place_medal',
    '🥈': 'second_place_medal',
    '🥉': 'third_place_medal',
    '👑': 'crown',
    '💎': 'gem',
    '💰': 'moneybag',
    '💵': 'dollar',
    '💳': 'credit_card',
    '🔔': 'bell',
    '🔕': 'no_bell',
    '💡': 'bulb',
    '🔧': 'wrench',
    '🔨': 'hammer',
    '⚙️': 'gear',
    '🔒': 'lock',
    '🔓': 'unlock',
    '🔑': 'key',
    '🔍': 'mag',
    '🔗': 'link',
    '📎': 'paperclip',
    '✂️': 'scissors',
    '✏️': 'pencil2',
    '📝': 'memo',
    '📖': 'book',
    '📚': 'books',
    '📰': 'newspaper',
    '📋': 'clipboard',
    '📅': 'calendar',
    '📈': 'chart_with_upwards_trend',
    '📉': 'chart_with_downwards_trend',
    '📧': 'email',
    '✉️': 'envelope',
    '📥': 'inbox_tray',
    '📤': 'outbox_tray',
    '📦': 'package',
    '📞': 'phone',
    '💻': 'computer',
    '🖥️': 'desktop_computer',
    '⌨️': 'keyboard',
    '🖨️': 'printer',
    '📷': 'camera',
    '📹': 'video_camera',
    '🎤': 'microphone',
    '🎧': 'headphones',
    '🎵': 'musical_note',
    '🎶': 'notes',
    '🎸': 'guitar',
    '🎥': 'movie_camera',
    '🎬': 'clapper',
    '📺': 'tv',
    '📻': 'radio',
    '⏱️': 'stopwatch',
    '⏰': 'alarm_clock',
    '⌛': 'hourglass',
    '⏳': 'hourglass_flowing_sand',
    '🔋': 'battery',
    '🔌': 'electric_plug',
    '🚀': 'rocket',
    '✈️': 'airplane',
    '🚗': 'car',
    '🚲': 'bike',
    '🚢': 'ship',
    '⚓': 'anchor',
    '⚠️': 'warning',
    '🚧': 'construction',
    '🚨': 'rotating_light',
    '🚦': 'traffic_light',
    '🛑': 'stop_sign',
    '☕': 'coffee',
    '🍵': 'tea',
    '🍺': 'beer',
    '🍻': 'beers',
    '🍷': 'wine_glass',
    '🍸': 'cocktail',
    '🍕': 'pizza',
    '🍔': 'hamburger',
    '🍟': 'fries',
    '🌭': 'hotdog',
    '🌮': 'taco',
    '🌯': 'burrito',
    '🍿': 'popcorn',
    '🍦': 'ice_cream',
    '🍩': 'doughnut',
    '🍪': 'cookie',
    '🎂': 'birthday',
    '🍫': 'chocolate_bar',
    '🍬': 'candy',
    '🍭': 'lollipop',
    '🍎': 'apple',
    '🍏': 'green_apple',
    '🍐': 'pear',
    '🍊': 'orange',
    '🍋': 'lemon',
    '🍌': 'banana',
    '🍉': 'watermelon',
    '🍇': 'grapes',
    '🍓': 'strawberry',
    '🍑': 'peach',
    '🍒': 'cherries',
    '🥑': 'avocado',
    '🍆': 'eggplant',
    '🥔': 'potato',
    '🥕': 'carrot',
    '🌽': 'corn',
    '🌶️': 'hot_pepper',
    '🥦': 'broccoli',
    '🥚': 'egg',
    '🥓': 'bacon',
    '🥐': 'croissant',
    '🍞': 'bread',
    '🧀': 'cheese',
    '👀': 'eyes',
    '👁️': 'eye',
    '👂': 'ear',
    '👃': 'nose',
    '👄': 'lips',
    '👅': 'tongue',
    '🧠': 'brain',
    '⬆️': 'arrow_up',
    '⬇️': 'arrow_down',
    '⬅️': 'arrow_left',
    '➡️': 'arrow_right',
    '🔄': 'arrows_counterclockwise',
    '🔃': 'arrows_clockwise',
    '🆕': 'new',
    '🆓': 'free',
    '🆙': 'up',
    '🆒': 'cool',
    '🆗': 'ok',
    '🆘': 'sos',
    '⛔': 'no_entry',
    '🚫': 'no_entry_sign',
    '⭕': 'o',
    '⚪': 'white_circle',
    '⚫': 'black_circle',
    '🔴': 'red_circle',
    '🔵': 'blue_circle',
    '🔶': 'large_orange_diamond',
    '🔷': 'large_blue_diamond',
    '🔸': 'small_orange_diamond',
    '🔹': 'small_blue_diamond',
    '🔺': 'small_red_triangle',
    '🔻': 'small_red_triangle_down',
    '❓': 'question',
    '❔': 'grey_question',
    '❗': 'exclamation',
    '❕': 'grey_exclamation',
    '‼️': 'bangbang',
    '⁉️': 'interrobang',
};
/**
 * Convert Unicode emoji to Slack emoji name
 */
function unicodeToSlackEmoji(unicode) {
    // Direct lookup
    if (UNICODE_TO_SLACK[unicode]) {
        return UNICODE_TO_SLACK[unicode];
    }
    // Try without variation selector (some emojis have \uFE0F suffix)
    const withoutVariation = unicode.replace(/\uFE0F/g, '');
    if (UNICODE_TO_SLACK[withoutVariation]) {
        return UNICODE_TO_SLACK[withoutVariation];
    }
    // Return the unicode as-is if no mapping found (Slack might still accept it)
    return unicode;
}
/**
 * Sync hConnect reaction changes to Slack
 * Called from Firestore trigger when message reactions change
 */
async function syncHConnectReactionToSlack(serverId, channelId, messageId, beforeReactions, afterReactions, threadId) {
    firebase_functions_1.logger.info('[slack-outbound-reaction] syncHConnectReactionToSlack called', {
        serverId,
        channelId,
        messageId,
        threadId: threadId || null,
        beforeKeys: beforeReactions ? Object.keys(beforeReactions) : [],
        afterKeys: afterReactions ? Object.keys(afterReactions) : []
    });
    // Get the message to find its Slack timestamp
    const messagePath = threadId
        ? `servers/${serverId}/channels/${channelId}/threads/${threadId}/messages/${messageId}`
        : `servers/${serverId}/channels/${channelId}/messages/${messageId}`;
    const messageDoc = await firebase_1.db.doc(messagePath).get();
    if (!messageDoc.exists) {
        firebase_functions_1.logger.warn('[slack-outbound-reaction] Message not found', { messagePath });
        return;
    }
    const messageData = messageDoc.data();
    const slackTs = messageData?.slackMeta?.messageTs || messageData?.slackTs;
    if (!slackTs) {
        firebase_functions_1.logger.info('[slack-outbound-reaction] Message has no Slack timestamp, skipping', { messageId });
        return;
    }
    // Find active bridges for this channel that sync outbound
    const bridges = await findBridgesForHConnectChannel(serverId, channelId);
    const outboundBridges = bridges.filter(b => b.syncDirection === 'hconnect-to-slack' || b.syncDirection === 'bidirectional');
    if (outboundBridges.length === 0) {
        firebase_functions_1.logger.info('[slack-outbound-reaction] No outbound bridges', { channelId });
        return;
    }
    // Calculate added and removed reactions
    const before = beforeReactions || {};
    const after = afterReactions || {};
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
        const beforeEntry = before[key];
        const afterEntry = after[key];
        const emoji = afterEntry?.emoji || beforeEntry?.emoji;
        if (!emoji)
            continue;
        // Get users before and after (handle both object format and array format)
        const beforeUsers = new Set(beforeEntry?.users
            ? (typeof beforeEntry.users === 'object' ? Object.keys(beforeEntry.users) : beforeEntry.users)
            : []);
        const afterUsers = new Set(afterEntry?.users
            ? (typeof afterEntry.users === 'object' ? Object.keys(afterEntry.users) : afterEntry.users)
            : []);
        // Find added users (in after but not in before) - excluding slack: users
        const addedUsers = [...afterUsers].filter((u) => !beforeUsers.has(u) && !u.startsWith('slack:'));
        // Find removed users (in before but not in after) - excluding slack: users
        const removedUsers = [...beforeUsers].filter((u) => !afterUsers.has(u) && !u.startsWith('slack:'));
        if (addedUsers.length === 0 && removedUsers.length === 0) {
            continue; // No changes from hConnect users
        }
        const slackEmojiName = unicodeToSlackEmoji(emoji);
        firebase_functions_1.logger.info('[slack-outbound-reaction] Processing reaction change', {
            emoji,
            slackEmojiName,
            addedUsers,
            removedUsers
        });
        // Sync to each bridge
        for (const bridge of outboundBridges) {
            try {
                const workspace = await getWorkspaceByTeamId(serverId, bridge.slackTeamId);
                if (!workspace?.botAccessToken) {
                    firebase_functions_1.logger.warn('[slack-outbound-reaction] No workspace/token for bridge', { bridgeId: bridge.id });
                    continue;
                }
                // Add reaction if any hConnect users added it (bot adds on behalf of all)
                if (addedUsers.length > 0) {
                    try {
                        const response = await fetch('https://slack.com/api/reactions.add', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${workspace.botAccessToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                channel: bridge.slackChannelId,
                                timestamp: slackTs,
                                name: slackEmojiName
                            })
                        });
                        const result = await response.json();
                        if (!result.ok && result.error !== 'already_reacted') {
                            firebase_functions_1.logger.warn('[slack-outbound-reaction] Failed to add reaction', {
                                error: result.error,
                                emoji: slackEmojiName
                            });
                        }
                        else {
                            firebase_functions_1.logger.info('[slack-outbound-reaction] Reaction added to Slack', {
                                emoji: slackEmojiName,
                                messageTs: slackTs,
                                addedBy: addedUsers
                            });
                        }
                    }
                    catch (err) {
                        firebase_functions_1.logger.error('[slack-outbound-reaction] Error adding reaction', { error: err });
                    }
                }
                // Remove reaction if all hConnect users removed it (only remove if no hConnect users left)
                // We need to check if there are any non-slack users still reacting
                const remainingHConnectUsers = [...afterUsers].filter((u) => !u.startsWith('slack:'));
                if (removedUsers.length > 0 && remainingHConnectUsers.length === 0) {
                    try {
                        const response = await fetch('https://slack.com/api/reactions.remove', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${workspace.botAccessToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                channel: bridge.slackChannelId,
                                timestamp: slackTs,
                                name: slackEmojiName
                            })
                        });
                        const result = await response.json();
                        if (!result.ok && result.error !== 'no_reaction') {
                            firebase_functions_1.logger.warn('[slack-outbound-reaction] Failed to remove reaction', {
                                error: result.error,
                                emoji: slackEmojiName
                            });
                        }
                        else {
                            firebase_functions_1.logger.info('[slack-outbound-reaction] Reaction removed from Slack', {
                                emoji: slackEmojiName,
                                messageTs: slackTs,
                                removedBy: removedUsers
                            });
                        }
                    }
                    catch (err) {
                        firebase_functions_1.logger.error('[slack-outbound-reaction] Error removing reaction', { error: err });
                    }
                }
            }
            catch (err) {
                firebase_functions_1.logger.error('[slack-outbound-reaction] Error processing bridge', {
                    bridgeId: bridge.id,
                    error: err
                });
            }
        }
    }
}
//# sourceMappingURL=slack.js.map