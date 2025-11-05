const fs = require('fs');
const text = fs.readFileSync('src\\lib\\components\\voice\\VideoChat.svelte', 'utf8');
const match = text.match(/<script[^>]*>([\\s\\S]*?)<\\/script>/);
if (!match) {
  console.error('no script');
  process.exit(1);
}
const script = match[1];
let line = 1;
let stack = 0;
let inSingle = false;
let inDouble = false;
let inTemplate = false;
let inBlockComment = false;
let inLineComment = false;
let prev = '';
for (let i = 0; i < script.length; i += 1) {
  const ch = script[i];
  const next = script[i + 1];
  if (inBlockComment) {
    if (ch === '*' && next === '/') {
      inBlockComment = false;
      i += 1;
    }
  } else if (inLineComment) {
    if (ch === '\n') {
      inLineComment = false;
      line += 1;
    }
  } else if (inTemplate) {
    if (ch === '' && prev !== '\\') {
      inTemplate = false;
    } else if (ch === '\n') {
      line += 1;
    }
  } else if (inSingle) {
    if (ch === "'" && prev !== '\\') {
      inSingle = false;
    }
  } else if (inDouble) {
    if (ch === '"' && prev !== '\\') {
      inDouble = false;
    }
  } else {
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
    } else if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
    } else if (ch === '') {
      inTemplate = true;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === '{') {
      stack += 1;
      console.log('open { at line ' + line + ' total ' + stack);
    } else if (ch === '}') {
      stack -= 1;
      console.log('close } at line ' + line + ' total ' + stack);
    }
  }
  if (ch === '\n') {
    line += 1;
  }
  prev = ch;
}
console.log('final stack ' + stack);
