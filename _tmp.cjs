const fs = require('fs');
const c = fs.readFileSync('README.md', 'utf-8');
const lines = c.split('\n');
console.log('Lines:', lines.length);
const re = /^## /gm;
let m;
while ((m = re.exec(c)) !== null) {
  const lineNum = c.substring(0, m.index).split('\n').length;
  const endOfLine = c.indexOf('\n', m.index);
  const headerLine = endOfLine >= 0 ? c.substring(m.index, endOfLine) : c.substring(m.index);
  console.log(lineNum + ': ' + headerLine);
}
fs.unlinkSync('_tmp.js');