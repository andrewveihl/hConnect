import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';

const source = readFileSync('Child.svelte', 'utf8');
const result = compile(source, { filename: 'Child.svelte', runes: true, generate: 'dom' });
console.log(result.js.code);
