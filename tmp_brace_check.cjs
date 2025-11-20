const fs = require('fs');
const text = fs.readFileSync('tmp_script.ts', 'utf8');
let line = 1;
let col = 0;
let state = 'normal';
let stack = [];
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  const next = text[i + 1];
  col++;
  switch (state) {
    case 'normal':
      if (ch === '/' && next === '/') {
        state = 'lineComment';
        i++;
        col++;
        break;
      }
      if (ch === '/' && next === '*') {
        state = 'blockComment';
        i++;
        col++;
        break;
      }
      if (ch === "'") {
        state = 'singleQuote';
        break;
      }
      if (ch === '"') {
        state = 'doubleQuote';
        break;
      }
      if (ch === '`') {
        state = 'template';
        break;
      }
      if (ch === '{') {
        stack.push({ line, col, index: i });
      } else if (ch === '}') {
        if (!stack.length) {
          console.log('Unmatched closing brace at', line, col);
        } else {
          stack.pop();
        }
      }
      break;
    case 'lineComment':
      if (ch === '\n') {
        state = 'normal';
      }
      break;
    case 'blockComment':
      if (ch === '*' && next === '/') {
        state = 'normal';
        i++;
        col++;
      }
      break;
    case 'singleQuote':
      if (ch === '\\') {
        i++;
        col++;
      } else if (ch === "'") {
        state = 'normal';
      }
      break;
    case 'doubleQuote':
      if (ch === '\\') {
        i++;
        col++;
      } else if (ch === '"') {
        state = 'normal';
      }
      break;
    case 'template':
      if (ch === '\\') {
        i++;
        col++;
      } else if (ch === '`') {
        state = 'normal';
      }
      break;
  }
  if (ch === '\n') {
    line++;
    col = 0;
  }
}
if (stack.length) {
  console.log('Unclosed braces:', stack.length);
  for (const entry of stack.slice(-10)) {
    console.log('  open at line', entry.line, 'col', entry.col);
  }
} else {
  console.log('All braces balanced');
}