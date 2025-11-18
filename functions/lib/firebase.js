"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messaging = exports.db = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const app = (0, app_1.getApps)().length ? (0, app_1.getApps)()[0] : (0, app_1.initializeApp)();
exports.db = (0, firestore_1.getFirestore)(app);
exports.messaging = (0, messaging_1.getMessaging)(app);
//# sourceMappingURL=firebase.js.map