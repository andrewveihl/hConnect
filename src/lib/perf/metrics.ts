// src/lib/perf/metrics.ts
// Performance instrumentation for measuring click-to-paint, listener counts, and memory

import { browser } from '$app/environment';
import { getListenerCount, getStats as getListenerStats } from './listenerPool';
import { getCacheStats } from './cacheDb';
import { getOutboxStats } from './outbox';

/* ===========================
   Configuration
=========================== */
const MAX_SAMPLES = 100;
const MEMORY_SAMPLE_INTERVAL = 30 * 1000; // 30 seconds

/* ===========================
   Types
=========================== */
export type MetricSample = {
	time: number;
	value: number;
	label?: string;
};

export type MetricType =
	| 'serverSwitch'
	| 'channelSwitch'
	| 'dmSwitch'
	| 'messageSend'
	| 'listenerCreated'
	| 'memoryUsage';

/* ===========================
   Metrics Storage
=========================== */
const metrics = new Map<MetricType, MetricSample[]>();

// Initialize metric arrays
const metricTypes: MetricType[] = [
	'serverSwitch',
	'channelSwitch',
	'dmSwitch',
	'messageSend',
	'listenerCreated',
	'memoryUsage'
];
for (const type of metricTypes) {
	metrics.set(type, []);
}

/* ===========================
   Timing Helpers
=========================== */
const activeTimers = new Map<string, number>();

/**
 * Start timing an operation
 */
export function startTiming(id: string): void {
	activeTimers.set(id, performance.now());
}

/**
 * End timing and record the metric
 * Returns the duration in milliseconds
 */
export function endTiming(id: string, metricType: MetricType, label?: string): number {
	const startTime = activeTimers.get(id);
	if (startTime === undefined) {
		console.warn(`[metrics] No start time found for timer: ${id}`);
		return -1;
	}

	activeTimers.delete(id);
	const duration = performance.now() - startTime;

	recordMetric(metricType, duration, label);

	return duration;
}

/**
 * Cancel a timer without recording
 */
export function cancelTiming(id: string): void {
	activeTimers.delete(id);
}

/* ===========================
   Metric Recording
=========================== */
export function recordMetric(type: MetricType, value: number, label?: string): void {
	const samples = metrics.get(type);
	if (!samples) return;

	samples.push({
		time: Date.now(),
		value,
		label
	});

	// Trim old samples
	if (samples.length > MAX_SAMPLES) {
		samples.shift();
	}

	// Log slow operations in dev mode
	if (import.meta.env.DEV) {
		const thresholds: Record<MetricType, number> = {
			serverSwitch: 200,
			channelSwitch: 150,
			dmSwitch: 350, // DMs involve more data loading (thread meta, profiles, messages)
			messageSend: 100,
			listenerCreated: 0, // Always log
			memoryUsage: 0 // Don't warn
		};

		const threshold = thresholds[type];
		if (threshold > 0 && value > threshold) {
			console.warn(`[metrics] Slow ${type}: ${value.toFixed(1)}ms (threshold: ${threshold}ms)`, label);
		}
	}
}

/* ===========================
   Metric Queries
=========================== */
export function getMetricSamples(type: MetricType): MetricSample[] {
	return [...(metrics.get(type) ?? [])];
}

export function getMetricStats(type: MetricType): {
	count: number;
	avg: number;
	min: number;
	max: number;
	p50: number;
	p95: number;
	recent: MetricSample[];
} {
	const samples = metrics.get(type) ?? [];
	const values = samples.map((s) => s.value);

	if (values.length === 0) {
		return {
			count: 0,
			avg: 0,
			min: 0,
			max: 0,
			p50: 0,
			p95: 0,
			recent: []
		};
	}

	const sorted = [...values].sort((a, b) => a - b);
	const sum = values.reduce((a, b) => a + b, 0);

	return {
		count: values.length,
		avg: sum / values.length,
		min: sorted[0],
		max: sorted[sorted.length - 1],
		p50: sorted[Math.floor(sorted.length * 0.5)],
		p95: sorted[Math.floor(sorted.length * 0.95)],
		recent: samples.slice(-10)
	};
}

/* ===========================
   Aggregated Summary
=========================== */
export function getSummary() {
	const listenerStats = getListenerStats();
	const cacheStats = getCacheStats();
	const outboxStats = getOutboxStats();

	return {
		timing: {
			serverSwitch: getMetricStats('serverSwitch'),
			channelSwitch: getMetricStats('channelSwitch'),
			dmSwitch: getMetricStats('dmSwitch'),
			messageSend: getMetricStats('messageSend')
		},
		listeners: {
			total: listenerStats.totalListeners,
			totalRefCount: listenerStats.totalRefCount,
			entries: listenerStats.entries.slice(0, 10) // Top 10 by last accessed
		},
		cache: cacheStats,
		outbox: outboxStats,
		memory: getMetricStats('memoryUsage'),
		targets: {
			serverSwitchP95: '<150ms',
			dmSwitchP95: '<150ms',
			messageSendP95: '<50ms',
			maxListeners: '8'
		}
	};
}

/* ===========================
   Memory Tracking
=========================== */
let memorySamplingInterval: ReturnType<typeof setInterval> | null = null;

function sampleMemory(): void {
	if (!browser) return;

	// Use performance.memory if available (Chrome only)
	const perf = performance as any;
	if (perf.memory) {
		const usedMB = perf.memory.usedJSHeapSize / (1024 * 1024);
		recordMetric('memoryUsage', usedMB);
	}
}

export function startMemorySampling(): void {
	if (memorySamplingInterval) return;

	sampleMemory(); // Initial sample
	memorySamplingInterval = setInterval(sampleMemory, MEMORY_SAMPLE_INTERVAL);
}

export function stopMemorySampling(): void {
	if (memorySamplingInterval) {
		clearInterval(memorySamplingInterval);
		memorySamplingInterval = null;
	}
}

/* ===========================
   Listener Count Tracking
=========================== */
let lastListenerCount = 0;

export function checkListenerGrowth(): void {
	const current = getListenerCount();
	if (current > lastListenerCount) {
		const created = current - lastListenerCount;
		recordMetric('listenerCreated', created);

		if (import.meta.env.DEV && current > 8) {
			console.warn(`[metrics] High listener count: ${current} (limit: 8)`);
		}
	}
	lastListenerCount = current;
}

/* ===========================
   Convenience Functions
=========================== */
export function timeServerSwitch(serverId: string): () => number {
	const timerId = `serverSwitch:${serverId}:${Date.now()}`;
	startTiming(timerId);
	return () => endTiming(timerId, 'serverSwitch', serverId);
}

export function timeChannelSwitch(channelId: string): () => number {
	const timerId = `channelSwitch:${channelId}:${Date.now()}`;
	startTiming(timerId);
	return () => endTiming(timerId, 'channelSwitch', channelId);
}

export function timeDmSwitch(threadId: string): () => number {
	const timerId = `dmSwitch:${threadId}:${Date.now()}`;
	startTiming(timerId);
	return () => endTiming(timerId, 'dmSwitch', threadId);
}

export function timeMessageSend(): () => number {
	const timerId = `messageSend:${Date.now()}`;
	startTiming(timerId);
	return () => endTiming(timerId, 'messageSend');
}

/* ===========================
   Initialization
=========================== */
if (browser) {
	// Start memory sampling after a short delay
	setTimeout(() => {
		startMemorySampling();
	}, 5000);

	// Check listener growth periodically
	setInterval(() => {
		checkListenerGrowth();
	}, 10000);
}

/* ===========================
   Debug interface
=========================== */
// Expose debug commands on window
if (browser && typeof window !== 'undefined') {
	(window as any).__perfMetrics = {
		getSummary,
		getMetricStats,
		getMetricSamples,
		recordMetric,
		timeServerSwitch,
		timeChannelSwitch,
		timeDmSwitch,
		timeMessageSend
	};
}
