// src/lib/perf/index.ts
// Main entry point for performance infrastructure
// Re-exports all modules for convenient imports

export {
	// CacheDB
	getServerRail,
	setServerRail,
	setServerRailMemory,
	getDmRail,
	setDmRail,
	setDmRailMemory,
	getServerView,
	getServerViewMemory,
	setServerView,
	setServerViewMemory,
	updateServerViewLastChannel,
	getThreadView,
	getThreadViewMemory,
	setThreadView,
	setThreadViewMemory,
	appendMessagesToThreadView,
	prependMessagesToThreadView,
	threadKey,
	dmThreadKey,
	getCachedAvatarUrl,
	cacheAvatarBlob,
	clearAllCaches,
	getCacheStats,
	getRecentEvents as getCacheEvents,
	preloadCacheFromDb,
	isCachePreloaded,
	type ServerRailEntry,
	type DMRailEntry,
	type ChannelEntry,
	type ServerViewData,
	type ThreadViewMessage,
	type ThreadViewData
} from './cacheDb';

export {
	// ListenerPool
	listenerKey,
	getOrCreateListener,
	forceUnsubscribe,
	forceUnsubscribePrefix,
	hasListener,
	getListenerCount,
	cleanupAllListeners,
	registerActiveViewListener,
	cleanupActiveViewListeners,
	getStats as getListenerStats,
	getRecentEvents as getListenerEvents,
	getActiveListenerKeys,
	type ListenerEntry,
	type ListenerEvent
} from './listenerPool';

export {
	// Outbox
	generateClientId,
	queueMessage,
	queueChannelMessage,
	queueDMMessage,
	queueThreadMessage,
	registerSendFunctions,
	retryMessage,
	cancelMessage,
	getPendingMessages,
	hasPendingMessages,
	subscribePendingMessages,
	mergeWithPending,
	getQueueLength,
	getFailedMessages,
	clearQueue,
	clearFailedMessages,
	getOutboxStats,
	outboxQueue,
	pendingByTarget,
	type MessageStatus,
	type OutboxMessage,
	type PendingMessage
} from './outbox';

export {
	// Metrics
	startTiming,
	endTiming,
	cancelTiming,
	recordMetric,
	getMetricSamples,
	getMetricStats,
	getSummary,
	timeServerSwitch,
	timeChannelSwitch,
	timeDmSwitch,
	timeMessageSend,
	startMemorySampling,
	stopMemorySampling,
	checkListenerGrowth,
	type MetricSample,
	type MetricType
} from './metrics';

export {
	// Firestore Helpers
	subscribeServerRailOptimized,
	subscribeDmRailOptimized,
	subscribeServerViewOptimized,
	subscribeChannelMessagesOptimized,
	subscribeDmMessagesOptimized,
	cleanupServerListeners,
	cleanupChannelListeners,
	cleanupDmListeners
} from './firestoreHelpers';

export {
	// Message Send (with local echo)
	initializeOutbox,
	sendChannelMessageOptimized,
	sendDMMessageOptimized,
	sendThreadMessageOptimized,
	sendGifOptimized,
	type MessagePayload
} from './messageSend';
